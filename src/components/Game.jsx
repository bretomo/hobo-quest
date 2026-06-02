'use client'
import { useState, useEffect, useRef } from "react";
import { loadWorld, saveWorld as sbSaveWorld, loadCharacter, saveCharacter, subscribeToWorld, unsubscribe, sendChatMessage } from '../lib/supabase';

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&family=VT323&display=swap');`;

const BOROUGHS = [
  { id:"bronx",     name:"THE BRONX",  short:"BRX", color:"#e63946", heat:8, opp:6, base:{weed:80, pills:12, powder:60}, adjacent:["manhattan","queens"],       copBase:7},
  { id:"brooklyn",  name:"BROOKLYN",   short:"BKN", color:"#f4a261", heat:5, opp:8, base:{weed:90, pills:15, powder:70}, adjacent:["manhattan","queens","staten"],copBase:4},
  { id:"manhattan", name:"MANHATTAN",  short:"MAN", color:"#e9c46a", heat:9, opp:9, base:{weed:110,pills:18, powder:90}, adjacent:["bronx","brooklyn","queens"],  copBase:9},
  { id:"queens",    name:"QUEENS",     short:"QNS", color:"#2a9d8f", heat:4, opp:7, base:{weed:85, pills:13, powder:65}, adjacent:["bronx","brooklyn","manhattan"],copBase:5},
  { id:"staten",    name:"STATEN IS.", short:"STN", color:"#457b9d", heat:3, opp:4, base:{weed:70, pills:10, powder:55}, adjacent:["brooklyn"],                   copBase:2},
];

// ── ECONOMICS CONSTANTS ────────────────────────────────────────────────────
const MAX_CARRY_CASH = 500;       // cash above this makes you a robbery target
const PRODUCT_WEIGHT = {weed:1,pills:1.5,powder:2}; // weight units per item
const MAX_CARRY_WEIGHT = 10;      // total weight units before penalty
const MIN_SELL_PLAYERS = 2;       // players selling same product before price drops

// ── ADDICTION SYSTEM ─────────────────────────────────────────────────────────
const CLASS_SUBSTANCE = {
  veteran:      {name:"alcohol", product:null,    icon:"🍺", buyCost:15, desc:"The bottle. Only thing that quiets it."},
  schemer:      {name:"pills",   product:"pills",  icon:"💊", buyCost:0,  desc:"Keeps the edge. Functional. Mostly."},
  ghost:        {name:"weed",    product:"weed",   icon:"🌿", buyCost:0,  desc:"Stays level. Needs it to stay level."},
  hustler:      {name:"powder",  product:"powder", icon:"❄️", buyCost:0,  desc:"Fuels the grind. Can't stop now."},
  junkie:       {name:"anything",product:null,     icon:"💉", buyCost:20, desc:"No preference. Just need something."},
  undocumented: {name:"stress",  product:null,     icon:"😮", buyCost:0,  desc:"No substances. Just pure survival anxiety."},
  vampire:      {name:"blood",   product:null,     icon:"🩸", buyCost:0,  desc:"Already handled. Ancient hunger."},
  fixer:        {name:"pills",   product:"pills",  icon:"💊", buyCost:0,  desc:"Functional. Denies it completely."},
  rat:          {name:"powder",  product:"powder", icon:"❄️", buyCost:0,  desc:"Paranoia feeds the habit."},
};
const ADDICTION_LEVELS = [
  {min:0,  max:19, name:"Clean",     icon:"○", desc:"No dependency yet."},
  {min:20, max:39, name:"Curious",   icon:"◔", desc:"Starting to notice the absence."},
  {min:40, max:59, name:"Hooked",    icon:"◑", desc:"It's part of the routine now."},
  {min:60, max:79, name:"Dependent", icon:"◕", desc:"Can't function right without it."},
  {min:80, max:94, name:"Consumed",  icon:"●", desc:"It runs your day. Not you."},
  {min:95, max:100,name:"Destroyed", icon:"☠", desc:"Everything else is secondary."},
];
const getAddictionLevel=(score)=>ADDICTION_LEVELS.find(l=>score>=l.min&&score<=l.max)||ADDICTION_LEVELS[0];
const HIGH_EVENTS = {
  weed:[
    {msg:"You smoke too much and spend hours convinced someone is watching you. He's just eating.",effect:{mental:5,heat:1}},
    {msg:"You get high and talk to Ray for hours. You needed that more than the money.",effect:{mental:15,hunger:-10}},
    {msg:"Blazed out of your mind, you front product to someone you've never met.",effect:{cash:-30}},
    {msg:"You get high and forget you were supposed to move today. Hours gone.",effect:{energy:-20}},
    {msg:"High enough that the city looks almost beautiful. For a few minutes you forget.",effect:{mental:20}},
  ],
  pills:[
    {msg:"The pills kick in wrong. Heart racing. You can't tell if anything is real.",effect:{health:-10,mental:-15}},
    {msg:"On the pills you close deals you'd never close sober. Money's real even if you aren't.",effect:{cash:40,heat:2}},
    {msg:"You take one more than you should. Six hours gone.",effect:{energy:-40,hunger:-20}},
    {msg:"Pills make you aggressive. You say something to the wrong person.",effect:{cash:-25,heat:3}},
    {msg:"Everything sharpens. Then it wears off and you crash hard.",effect:{cash:20,health:-15,energy:-30}},
  ],
  powder:[
    {msg:"First line and you're invincible. Hours later you're behind a dumpster.",effect:{cash:30,health:-25,heat:2}},
    {msg:"You spend everything you just made getting more. Don't remember doing it.",effect:{cash:-60}},
    {msg:"Powder makes you stupid brave. You approach someone you should have avoided.",effect:{health:-20,heat:3}},
    {msg:"Up for 40 hours. Made money. Lost more. Net negative. Can't sleep.",effect:{cash:-20,energy:-50,health:-10}},
    {msg:"Paranoid. Scratching. Convinced someone's been following you for days.",effect:{mental:-25,heat:1}},
  ],
  alcohol:[
    {msg:"Blackout. Different borough. $80 less. No memory of how.",effect:{cash:-80,health:-15,mental:-10}},
    {msg:"Drunk enough to feel brave. You fight someone twice your size.",effect:{health:-25,cash:-20}},
    {msg:"Three drinks in and you're buying rounds for strangers.",effect:{cash:-45,mental:10}},
    {msg:"Drunk and honest, you tell someone something you shouldn't have.",effect:{heat:2,mental:-10}},
  ],
  anything:[
    {msg:"Whatever it was it was too much. You're not sure what day it is.",effect:{health:-20,mental:-20,energy:-40}},
    {msg:"You find something and take all of it. Consequences later.",effect:{health:-15,cash:-30,mental:-10}},
    {msg:"Using in an alley. Someone sees. Word gets back.",effect:{heat:3,mental:-5}},
    {msg:"The high hits different today. Not in a good way.",effect:{health:-30,mental:-25}},
    {msg:"You come down and the world is exactly as bad as you left it. But now you're worse.",effect:{health:-10,mental:-30,energy:-25}},
  ],
};
const WITHDRAWAL_EVENTS = {
  weed:["Can't sleep. Sweating. Everything irritates you. You snap at the wrong person.","The anxiety is back. That familiar dread that never fully went away.","Your hands won't stop shaking. Can't focus on anything."],
  pills:["Without the pills your body aches like you're 70 years old.","Your brain won't stop. The pills were the only thing keeping the noise down.","Withdrawal hits like a wall. Everything takes three times the effort."],
  powder:["The crash is physical. Your body is staging a revolt.","You'd do almost anything for a line right now. You catch yourself thinking things that scare you.","Running on fumes. Shaking. The world feels like it's moving through glass.","Three days without and your body is falling apart."],
  alcohol:["The shakes are bad today. Real withdrawal. Your hands betray you.","Without it the nightmares come back. You just wait for morning.","Your body needs it now. That's the part nobody tells you."],
  anything:["Whatever's in your system is clearing and what's underneath is worse.","The body remembers everything you put it through. Today it's sending you the bill.","You need something. Anything. The desperation makes you reckless.","Rock bottom has a basement. You're finding that out today."],
  stress:["The anxiety is crushing today. No way out, no way forward.","Lying awake calculating how long you can survive. The math never comes out right.","Your body is in permanent fight-or-flight. Everything is a threat."],
};

// ── HUSTLE LIMITS ────────────────────────────────────────────────────────────
// Base daily hustle allowance per archetype
const HUSTLE_DAILY_MAX = {
  veteran:      3,   // intimidation-based, draws heat fast
  schemer:      4,   // con artist, more creative
  ghost:        3,   // quiet, careful
  hustler:      5,   // this is literally their thing
  junkie:       3,   // unreliable but persistent
  undocumented: 3,   // careful, can't draw attention
  vampire:      2,   // not their preferred method
  fixer:        2,   // brokers deals instead
  rat:          2,   // handler pays them instead
  drifter:      3,
  schizo:       99,  // no limit — chaos fires every time anyway
};
// Diminishing returns multiplier by hustle number today
const HUSTLE_PAYOUT_MULT = [1.0, 0.7, 0.45, 0.25, 0.10];
// Borough cooldown — same borough twice in a row costs heat
const HUSTLE_SAME_BORO_HEAT = 2;
const DEMAND_DROP = 0.15;         // price drop per extra seller
const DEMAND_SPIKE = 0.20;        // price spike per day without supply

// ── COP SYSTEM ────────────────────────────────────────────────────────────
const WANTED_TIERS = [
  {stars:0, name:"Clean",          desc:"Nobody knows your name.",                      movePenalty:0, dealPenalty:0,  cantEnter:[]},
  {stars:1, name:"Known",          desc:"Local cops know your face.",                   movePenalty:0, dealPenalty:0.1,cantEnter:[]},
  {stars:2, name:"Flagged",        desc:"Precinct has your description.",               movePenalty:5, dealPenalty:0.2,cantEnter:[]},
  {stars:3, name:"Hunted",         desc:"Plainclothes following you.",                  movePenalty:10,dealPenalty:0.3,cantEnter:[]},
  {stars:4, name:"Task Force",     desc:"Coordinated pursuit. Move fast.",              movePenalty:15,dealPenalty:0.5,cantEnter:["manhattan"]},
  {stars:5, name:"Federal",        desc:"Feds involved. Manhattan is locked to you.",   movePenalty:20,dealPenalty:0.7,cantEnter:["manhattan","bronx"]},
];
const PATROL_EVENTS = [
  "A marked unit rolls slow — too slow — down the block, brake lights tapping every few yards. You feel it before you fully see it. Your body knew first.",
  "Two plainclothes step out of a parked Chevy Impala like they own the sidewalk, which right now they do. Badges not visible but you know. Wrong shoes. Always the shoes.",
  "Helicopter banking in low circles overhead, spotlight off but the pattern means they're looking for something specific. Someone called it in. Could be you. Could be anything.",
  "Checkpoint at the corner — two officers, clipboards, the kind of stop-and-frisk energy that never fully went away regardless of what they said on the news.",
  "Unmarked white van, engine idling, parked where vans don't park. Nobody getting out. Nobody getting in. Just watching.",
  "Officer walking the block alone, slow, hands loose, making eye contact with everyone who walks past. Old school patrol. More personal. More dangerous.",
  "Radio chatter from somewhere you can't pinpoint. They're coordinating something. Three blocks, maybe four. You're in the middle.",
  "The block clears fast. Regulars melt away like they got the same message at the same second. That's your message too.",
  "Narcotics unit — you can tell from the way they move in pairs, casual but purposeful, covering angles. They're not here by accident.",
];
const COP_RESPONSES = {
  hide:  {energyCost:25,heatDrop:1,successRate:0.75,msg:"You find a doorway and go still. They pass."},
  run:   {energyCost:30,healthCost:10,heatDrop:0,successRate:0.85,msg:"You move fast through back streets."},
  bribe: {cashCost:60,heatDrop:2,successRate:0.65,charmbased:true,msg:"You make it worth their while."},
  talk:  {heatDrop:1,successRate:0.55,streetiqbased:true,msg:"You talk your way through it. Mostly."},
};
const CAPTAIN_NAME = "The Captain";
const getCopPresence=(bId,worldCops,day)=>{
  const base=getBoro(bId)?.copBase||5;
  const worldBoost=(worldCops?.[bId]||0);
  return Math.min(10,base+worldBoost);
};
const getWantedTier=(heat)=>WANTED_TIERS[Math.min(Math.floor(heat/2),5)];
const getCarryWeight=(product)=>Object.entries(product||{}).reduce((sum,[k,v])=>sum+(PRODUCT_WEIGHT[k]||1)*v,0);
const ARCHETYPES = [
  { id:"veteran",      name:"THE VETERAN",      icon:"🎖", color:"#e63946", desc:"Combat-hardened. Slow to trust. Hard to kill.", stats:{hustle:4,streetiq:5,toughness:9,charm:3,heat:2}, gear:["Dog tags","Army jacket","Combat knife"], xp:{fight:2,rest:1},
    special:"Standard archetype. No restrictions." },
  { id:"schemer",      name:"THE SCHEMER",      icon:"🃏", color:"#e9c46a", desc:"Always working an angle. Silver tongue, empty pockets.", stats:{hustle:8,streetiq:9,toughness:3,charm:8,heat:4}, gear:["Burner phone","Ledger","Fake ID"], xp:{deal:2,talk:2},
    special:"Standard archetype. No restrictions." },
  { id:"ghost",        name:"THE GHOST",        icon:"🌫", color:"#a8dadc", desc:"Nobody sees you. Nobody knows your name.", stats:{hustle:6,streetiq:7,toughness:5,charm:4,heat:1}, gear:["Gray hoodie","Lock picks","Transit card"], xp:{move:1,scout:2},
    special:"Standard archetype. No restrictions." },
  { id:"hustler",      name:"THE HUSTLER",      icon:"💵", color:"#2a9d8f", desc:"Money is the only language. Starts rich, fights dirty.", stats:{hustle:10,streetiq:7,toughness:2,charm:6,heat:3}, gear:["Burner phone","Money clip"], xp:{deal:3,hustle:2},
    startCash:80, special:"Sees buy/sell spread before committing. Market prices favorable. Terrible in a fight." },
  { id:"junkie",       name:"THE JUNKIE",       icon:"💉", color:"#8b5cf6", desc:"Everyone underestimates you. That's your weapon.", stats:{hustle:5,streetiq:9,charm:9,toughness:3,heat:3}, gear:["Works","Notebook","Crumpled map"], xp:{talk:2,scout:2},
    habit:20, special:"HARD MODE. $20/day habit or health drops. Unique missions. Highest charm in the game." },
  { id:"undocumented", name:"THE UNDOCUMENTED", icon:"🌐", color:"#f4a261", desc:"Off the grid. No name, no record, no mercy.", stats:{hustle:7,streetiq:8,toughness:5,charm:6,heat:0}, gear:["Fake transit pass","Community directory","Burner"], xp:{move:2,deal:1},
    special:"Can't use shelters or hospitals. Wanted system replaced by Ghost Mode. Tight community network." },
  { id:"vampire", name:"THE VAMPIRE", icon:"🧛", color:"#9d4edd", desc:"Ancient. Predatory. Hiding in plain sight among the forgotten.", stats:{hustle:5,streetiq:8,toughness:7,charm:9,heat:0}, gear:["Black coat","Burner (blocked contact)","Sunglasses"], xp:{fight:2,talk:1},
    startCash:0, isVampire:true,
    special:"HARD MODE. No food needed (hunger irrelevant). Burns in sunlight (warmth drains during day). Feeds on NPCs and players for health. Unique night economy. Charm-based predator." },
  { id:"fixer", name:"THE FIXER", icon:"🔧", color:"#06d6a0", desc:"Knows everyone. Fixes everything. Takes a cut of all of it.", stats:{hustle:7,streetiq:9,toughness:3,charm:7,heat:1}, gear:["Contact book","Wire cutters","Encrypted phone"], xp:{talk:2,deal:1},
    startCash:60, isFixer:true,
    special:"Brokers deals between players for 10%. Repairs gear. Wires cash. Never needs to fight. At max level takes a cut of every world transaction automatically." },
  { id:"rat", name:"THE RAT", icon:"🐀", color:"#ff6b6b", desc:"Plays both sides. The most dangerous thing on the street.", stats:{hustle:6,streetiq:10,toughness:2,charm:7,heat:5}, gear:["Handler's number","Burner","Small recorder"], xp:{scout:2,talk:1},
    startCash:30, isRat:true,
    special:"MORALLY COMPLEX. Informs on players for cash. Files tips that spike other players' heat. Lives in permanent social danger — if exposed, everyone hunts you. Double agent mechanic." },
  { id:"schizo", name:"THE PROPHET", icon:"🌀", color:"#c77dff", desc:"The city speaks to you. Nobody else can hear it.", stats:{hustle:7,streetiq:4,toughness:5,charm:6,heat:3}, gear:["Manifesto pages","Hospital bracelet","Lucky bottle cap"], xp:{hustle:1,fight:1,look:2}, startCash:25, isSchizo:true, special:"CHAOS CLASS. Every action has a 20% chance to go sideways — good or bad, you never know. Visions replace LOOK. Mental health works in reverse at Shattered — breakdown becomes breakthrough." },
  { id:"drifter", name:"THE DRIFTER", icon:"🐕", color:"#c9a96e", desc:"You and your dog. The city can't take what you don't have.", stats:{hustle:5,streetiq:6,toughness:6,charm:9,heat:0}, gear:["Leash & collar","Cardboard sign","Sleeping bag"], xp:{panhandle:3,talk:2},
    startCash:15, isDrifter:true,
    special:"Your dog changes everything. Highest panhandle yield in the game — people give to the dog. Dog can SCOUT ahead, GUARD your stash, and DISTRACT during encounters. Hard mode: no shelters (dog not allowed), low cash, but the dog boosts mental health passively and NPCs trust you more." },
];
const NPCS = [
  {id:"ray", name:"Ray", role:"Old-timer", b:"manhattan", icon:"👴", lines:[
    "Ray has been on this bench, or one like it, for going on eleven years. He looks at you the way someone looks at a photograph of themselves from before everything changed.",
    "He moves over without being asked. 'You got that look,' he says. 'New to the street or new to this block? Sit down before someone clocks you standing there thinking.'",
    "He doesn't ask your name. Out here, that's a form of respect.",
    "Sometimes, late at night, he talks about the Oregon Trail. His daughter loved that game.",
  ]},
  {id:"smoke", name:"Smoke", role:"Corner dealer", b:"brooklyn", icon:"💨", lines:[
    "Smoke sees you coming from half a block away. That's how he stays employed.",
    "'I hear you moving weight,' he says, not looking at you, watching something across the street. 'Respect. But this is my block. We clear on that?'",
    "'You need product, I know a guy who knows a guy. Come back with real cash. I don't do credit with people I don't know yet.'",
  ]},
  {id:"dee", name:"Dee", role:"Shelter worker", b:"bronx", icon:"🏠", lines:[
    "Dee has worked intake at three different shelters over eight years. She has seen every version of every story.",
    "'Beds at eight,' she says without looking up from her clipboard. 'Sign-in required. No product. You know the rules.'",
    "She drops her voice half a register. 'You look like you're holding something. I'm not asking what. Just be careful. This neighborhood is hot right now.'",
  ]},
  {id:"rico", name:"Rico", role:"Gang lieutenant", b:"queens", icon:"😤", lines:[
    "Rico is leaning against the wall with the specific stillness of someone who doesn't need to move to be dangerous.",
    "'You affiliated?' Not aggressive. Just a question. The most important question on this block.",
    "'Queens doesn't do freelancers. Not anymore. You work with us, you're protected. You work alone, you're a problem. Those are the options.'",
  ]},
  {id:"marta", name:"Marta", role:"Street medic", b:"staten", icon:"💊", lines:[
    "Marta carries a bag that looks like it's been through a war because it has been, in a way.",
    "'You're not the first person I've seen in this condition,' she says. She means it as comfort and somehow it lands that way.",
    "'I've got what you need. Not free — I have to buy this stuff somehow — but fair. Fairer than the ER, and they'd ask for ID.'",
  ]},
];
// ── NPC QUEST SYSTEM ──────────────────────────────────────────────────────────
// Each NPC has 3 quest tiers unlocked by rep level
// Quest states: locked | available | active | complete
const NPC_QUESTS = {
  ray: [
    {
      id:"ray_q1", npc:"ray", tier:1, repRequired:2,
      title:"Safe Passage",
      briefing:`There's a kid sleeping rough near 42nd. Cops keep moving him. I need someone to walk him to the Bronx shelter before midnight. I'd do it myself but my legs aren't what they were.`,
      task:"Walk someone to the Bronx shelter. Type COMPLETE RAY 1 after visiting the Bronx shelter.",
      requireBoro:"bronx", requireCheckin:false,
      duration:3, // days to complete
      reward:{cash:40, rep:2, mental:15, item:"Ray's Flask"},
      failPenalty:{rep:-1},
      completionFlavor:`Ray nods when you come back. Doesn't say much. Just slides you a flask. Good man.`,
    },
    {
      id:"ray_q2", npc:"ray", tier:2, repRequired:5,
      title:"Old Debts",
      briefing:`I'm owed money by a guy named Carver. Used to run Queens. He won't talk to me. But you could find him. Collect what he owes. $200. Don't tell him who sent you.`,
      task:"Collect the debt. Type COLLECT DEBT in Queens to find Carver.",
      requireBoro:"queens", requireFight:true,
      duration:5,
      reward:{cash:80, rep:3, skillPoints:1, item:"Ray's Ledger"},
      failPenalty:{rep:-2, cash:-30},
      completionFlavor:`Ray counts it slowly. Gives you half. I said collect. Didn't say keep none of it.`,
    },
    {
      id:"ray_q3", npc:"ray", tier:3, repRequired:8,
      title:"The Last Favor",
      briefing:`I need you to find my daughter. She lives in Brooklyn. Doesn't know I'm out here. Give her this letter. Don't tell her how I look. Just give her the letter and walk away.`,
      task:"Deliver the letter. Type DELIVER LETTER in Brooklyn.",
      requireBoro:"brooklyn",
      duration:7,
      reward:{cash:0, rep:5, mental:30, xp:100, unlock:"Ray becomes permanent crew member. +$20/day."},
      failPenalty:{rep:-3, mental:-20},
      completionFlavor:`You come back. Ray is already asleep on his bench. You leave a note. Some things don't need saying out loud.`,
    },
  ],
  // ── SECRET QUEST — unlocks at Level 8+ after all Ray quests complete ──
  ray_secret: [
    {
      id:"ray_secret_q1", npc:"ray", tier:4, repRequired:10,
      title:"Caulk the Wagon",
      secret:true, // hidden from QUESTS until eligible
      levelRequired:8,
      briefing:`Ray is quiet for a long time. Then: "I used to read the Oregon Trail to my daughter. Every night before bed. She always tried to ford the river." He looks at the Hudson. "Nobody fords the Hudson anymore. Everyone takes the bridge." He looks at you. "You've survived everything this city threw at you. I want to see you try something stupid." He slides you a piece of paper. A list of supplies.`,
      task:"Gather the supplies and ford the Hudson. CAULK WAGON to begin when ready.",
      requireItems:["Rope","Waterproof Bag","Raft Materials"],
      requireLevel:8,
      duration:7,
      reward:{
        cash:0,
        xp:500,
        rep:10,
        mental:50,
        item:"Oregon Trail Medal",
        title:"The Fordist",
        unlock:"Permanent title [THE FORDIST] shown next to your name forever.",
      },
      failPenalty:{rep:-2,cash:-50},
      completionFlavor:`Ray stands at the bank of the Hudson watching. You make it across. You're soaked, half-dead, and laughing. When you come back he has tears in his eyes. "My daughter would have loved you," he says. He doesn't say anything else. He doesn't need to.`,
    },
  ],
  smoke: [
    {
      id:"smoke_q1", npc:"smoke", tier:1, repRequired:2,
      title:"Test the Weight",
      briefing:`I've got product I need moved in Manhattan tonight. Can't do it myself - too hot. Move 3 bags up there and I'll cut you in.`,
      task:"Sell 3 bags of weed in Manhattan. Type COMPLETE SMOKE 1 after selling there.",
      requireBoro:"manhattan", requireSell:{product:"weed", qty:3},
      duration:3,
      reward:{cash:60, rep:2, product:{weed:2}},
      failPenalty:{rep:-1},
      completionFlavor:`Smoke counts the bills. Adds two of his own. You can move. I like that.`,
    },
    {
      id:"smoke_q2", npc:"smoke", tier:2, repRequired:5,
      title:"The Front",
      briefing:`My supplier is dry. There's a guy in the Bronx who has powder. He'll deal with you but not with me - old beef. Go cop 2 grams and bring it back. I'll triple your money.`,
      task:"Buy 2 powder in the Bronx and return to Brooklyn. Type COMPLETE SMOKE 2.",
      requireBoro:"brooklyn", requireProduct:{powder:2},
      duration:4,
      reward:{cash:120, rep:3, product:{pills:3}},
      failPenalty:{rep:-2},
      completionFlavor:`That's what I'm talking about. Smoke weighs it fast, doesn't look up. You're good people.`,
    },
    {
      id:"smoke_q3", npc:"smoke", tier:3, repRequired:8,
      title:"Territory",
      briefing:`Someone's been undercutting my price in Queens. I need it to stop. Go claim that Queens corner and hold it for 2 days. Send a message.`,
      task:"Claim and hold the Queens corner for 2 days. Type COMPLETE SMOKE 3.",
      requireBoro:"queens", requireCorner:"queens",
      duration:6,
      reward:{cash:150, rep:4, xp:80, unlock:"Smoke fronts product — buy now pay next day."},
      failPenalty:{rep:-3},
      completionFlavor:`That corner stays mine now. You're family.`,
    },
  ],
  dee: [
    {
      id:"dee_q1", npc:"dee", tier:1, repRequired:2,
      title:"Meal Run",
      briefing:`The shelter kitchen is out of supplies. I need someone to pick up a donation from the food bank in Queens. It's too heavy for me to carry alone.`,
      task:"Visit Queens and return to the Bronx. Type COMPLETE DEE 1.",
      requireBoro:"bronx",
      duration:2,
      reward:{cash:20, rep:2, survival:{hunger:40, mental:15}},
      failPenalty:{rep:-1},
      completionFlavor:`Dee smiles. First time you've seen it. You're a good person. Don't let the streets convince you otherwise.`,
    },
    {
      id:"dee_q2", npc:"dee", tier:2, repRequired:5,
      title:"Lost One",
      briefing:`There's a young woman who stopped coming in. She was regular for 6 months. I'm worried. Last I heard she was near the Manhattan waterfront. Can you find her?`,
      task:"Search Manhattan 3 times and return. Type COMPLETE DEE 2.",
      requireBoro:"bronx", requireSearch:3,
      duration:5,
      reward:{cash:30, rep:3, mental:20, survival:{health:20}},
      failPenalty:{rep:-1, mental:-10},
      completionFlavor:`She's okay. In a program upstate now. Dee doesn't say how you found that out. Some things are better not asked.`,
    },
    {
      id:"dee_q3", npc:"dee", tier:3, repRequired:8,
      title:"Advocate",
      briefing:`The city is trying to shut us down. I need someone to talk to the people in this borough - build some goodwill. Talk to everyone you can. Make them see us as neighbors.`,
      task:"Talk to every NPC in any borough. Type COMPLETE DEE 3.",
      requireAllNpcs:true,
      duration:7,
      reward:{cash:0, rep:5, mental:40, xp:120, unlock:"Dee provides free shelter access every night. No bed limits for you."},
      failPenalty:{rep:-2, mental:-15},
      completionFlavor:`Dee holds the door open. Come in whenever. This is your place too.`,
    },
  ],
  rico: [
    {
      id:"rico_q1", npc:"rico", tier:1, repRequired:2,
      title:"Prove It",
      briefing:`You want to run in Queens? Show me you can handle yourself. Win a fight. I'm watching.`,
      task:"Win one fight in Queens. Type COMPLETE RICO 1.",
      requireBoro:"queens", requireFight:true,
      duration:3,
      reward:{cash:50, rep:2, stats:{toughness:1}},
      failPenalty:{rep:-1},
      completionFlavor:`Rico doesn't clap. Just nods. That's the Queens version of respect.`,
    },
    {
      id:"rico_q2", npc:"rico", tier:2, repRequired:5,
      title:"Tax Collection",
      briefing:`Three blocks haven't paid this week. I need someone who can walk up to these people and remind them how things work out here. Non-negotiable.`,
      task:"Attack 2 players or fight 3 street enemies in Queens. Type COMPLETE RICO 2.",
      requireBoro:"queens", requireFights:3,
      duration:5,
      reward:{cash:100, rep:3, heat:-2},
      failPenalty:{rep:-2},
      completionFlavor:`Rico hands you a roll. You're on the clock now. Queens takes care of its people.`,
    },
    {
      id:"rico_q3", npc:"rico", tier:3, repRequired:8,
      title:"The Seat",
      briefing:`I'm moving up. Need someone to hold down Queens while I'm gone. Claim the corner. Keep it. Don't lose it for 3 days.`,
      task:"Hold the Queens corner for 3 days. Type COMPLETE RICO 3.",
      requireCorner:"queens",
      duration:7,
      reward:{cash:200, rep:5, xp:100, stats:{hustle:1,streetiq:1}, unlock:"Queens crew protection — players attacking you in Queens take double heat."},
      failPenalty:{rep:-3, cash:-50},
      completionFlavor:`Queens is yours when I'm gone. Don't embarrass me.`,
    },
  ],
  marta: [
    {
      id:"marta_q1", npc:"marta", tier:1, repRequired:2,
      title:"Supplies",
      briefing:`I'm running out of bandages and antiseptic. There's a pharmacy in Manhattan that throws out expired supplies. They won't give them to me - liability. But someone else might get them.`,
      task:"SEARCH Manhattan twice and return to Staten Island. Type COMPLETE MARTA 1.",
      requireBoro:"staten", requireSearch:2,
      duration:3,
      reward:{cash:0, rep:2, survival:{health:30}, item:"Marta's Kit"},
      failPenalty:{rep:-1},
      completionFlavor:`Marta unpacks the bag carefully. This will last six months. You probably saved someone's life and you'll never know it.`,
    },
    {
      id:"marta_q2", npc:"marta", tier:2, repRequired:5,
      title:"Overdose",
      briefing:`Someone called it in. East Brooklyn, near the tracks. I can't get there fast enough alone. Go stabilize them - get there, stay there, do what you can.`,
      task:"Visit Brooklyn and REST there. Type COMPLETE MARTA 2.",
      requireBoro:"staten", requireVisit:"brooklyn",
      duration:4,
      reward:{cash:0, rep:3, mental:25, survival:{health:15}, xp:50},
      failPenalty:{rep:-2, mental:-15},
      completionFlavor:`Marta doesn't say if they made it. You went. That's what matters.`,
    },
    {
      id:"marta_q3", npc:"marta", tier:3, repRequired:8,
      title:"The Clinic",
      briefing:`I've been trying to open a clinic in Staten Island for three years. I need someone to run security, handle the rough nights, keep the peace. I can't pay much. But I can keep you healthy.`,
      task:"Survive 5 more days and return to Marta. Type COMPLETE MARTA 3.",
      requireBoro:"staten", requireDays:5,
      duration:10,
      reward:{cash:0, rep:5, mental:50, xp:150, unlock:"Marta heals you for free anytime. Full health restore with VISIT MARTA."},
      failPenalty:{rep:-2},
      completionFlavor:`The clinic opens on a Tuesday. It's just a room with a cot and some supplies. It's everything.`,
    },
  ],
};

// Quest progress tracking helpers
const getAvailableQuests=(gs,npcs)=>{
  const active=gs.activeQuests||{};
  const done=gs.completedQuests||[];
  return Object.entries(NPC_QUESTS).flatMap(([npcId,quests])=>{
    const npc=npcs.find(n=>n.id===npcId);
    const npcRep=npc?.rep||0;
    return quests.filter(q=>{
      if(done.includes(q.id))return false;
      if(active[q.id])return false;
      if(npcRep<q.repRequired)return false;
      // only offer tier 2 if tier 1 done, etc.
      const tier=q.tier;
      if(tier>1){const prev=quests[tier-2];if(!done.includes(prev.id))return false;}
      return true;
    });
  });
};
const getActiveQuests=(gs)=>Object.values(gs.activeQuests||{});

const PRODUCTS = {
  weed:  {name:"Weed",  unit:"bag",  icon:"🌿", bm:0.6, rm:1.0},
  pills: {name:"Pills", unit:"pack", icon:"💊", bm:0.6, rm:1.5},
  powder:{name:"Powder",unit:"gram", icon:"❄️", bm:0.6, rm:2.5},
};
const RECIPES = {
  "fire weed": {inputs:{weed:3},   sellX:2.2, icon:"🔥", base:"weed",   desc:"3 bags → 1 fire pack (2.2x)"},
  "pressed":   {inputs:{pills:4},  sellX:2.5, icon:"💎", base:"pills",  desc:"4 packs → 1 pressed brick (2.5x)"},
  "raw cut":   {inputs:{powder:2}, sellX:2.0, icon:"⚗️", base:"powder", desc:"2 grams → 1 pure cut (2x)"},
};

// ── WEATHER SYSTEM ────────────────────────────────────────────────────────────
const WEATHER_TYPES = {
  clear:    { id:"clear",    icon:"☀️",  name:"Clear",        warmthDrain:1,  bustMult:1.0, movePenalty:0, desc:"Good day to work." },
  cloudy:   { id:"cloudy",   icon:"☁️",  name:"Overcast",     warmthDrain:1.5,bustMult:0.9, movePenalty:0, desc:"Cops are lazy today." },
  rain:     { id:"rain",     icon:"🌧",  name:"Rain",         warmthDrain:2.5,bustMult:0.8, movePenalty:0, desc:"Rain keeps eyes indoors. Lower heat." },
  fog:      { id:"fog",      icon:"🌫",  name:"Fog",          warmthDrain:1.5,bustMult:0.6, movePenalty:0, desc:"Can't see 10 feet. Hard to get clocked." },
  blizzard: { id:"blizzard", icon:"❄️",  name:"Blizzard",     warmthDrain:5,  bustMult:0.5, movePenalty:15,desc:"Streets are empty. Warmth draining fast." },
  heatwave: { id:"heatwave", icon:"🔥",  name:"Heat Wave",    warmthDrain:0,  bustMult:1.4, movePenalty:0, desc:"Cops are everywhere. Everyone's on edge." },
  storm:    { id:"storm",    icon:"⛈",  name:"Thunderstorm", warmthDrain:3,  bustMult:0.7, movePenalty:5, desc:"Heavy rain. Nobody's watching the corners." },
};
// borough-weighted weather probabilities by season (day % 4 = rough season)
const WEATHER_POOL = {
  0: ["clear","clear","cloudy","rain","heatwave","heatwave"],        // summer
  1: ["clear","cloudy","rain","rain","storm","fog"],                  // fall
  2: ["cloudy","rain","blizzard","blizzard","fog","clear"],           // winter
  3: ["clear","clear","cloudy","rain","storm","fog"],                 // spring
};
const SAFEHOUSE_COST = 500;
const SAFEHOUSE_UPGRADE_COST = 300;

const LVL_XP = [0,100,250,450,700,1000,1400,1900,2500,3200];
const EVTS = {
  normal:[
    "A street preacher hollers scripture at three pigeons and a discarded shopping cart. The pigeons aren't listening. Neither are you.",
    "A kid on a BMX nearly takes your kneecap off. He doesn't look back. You respect that.",
    "MetroCard face-down near the turnstile. $2.75 still loaded. Small victory.",
    "Old Dominican man on his stoop nods at you like he knows exactly what you're doing out here. Maybe he does.",
    "Halal cart smoke hits from half a block away. Your stomach makes a sound that embarrasses you.",
    "Two women arguing outside a laundromat about something that happened in 2019. The city holds grudges.",
    "Con Ed crew tearing up the sidewalk at 11pm. Nobody asked why. Nobody ever does.",
    "Delivery driver locks his e-bike with four different locks. Watches you watch him. You nod. He nods back.",
    "A tourist asks you for directions to the High Line. You give them wrong ones. Not maliciously. You just don't care.",
    "Bodega cat watches you from the window with the thousand-yard stare of someone who has seen everything.",
    "Someone's mattress on the curb. Stained but thick. You file the location away for later.",
    "The 4 train screams overhead and for three seconds nobody can hear anything.",
    "Church van parked on the corner. Someone inside watching the block. Not cops. Something else.",
    "Couple arguing on a fire escape four floors up. Their words fall down like rain.",
  ],
  hot:     ["Unmarked Crown Vic rolling slow two blocks back.","Patrol car outside the bodega. You take the long way.","Narco unit sweeping the ave. Not tonight.","Somebody on the corner clocked you. Word travels fast."],
  broke:   ["Empty pockets make a man desperate. You feel it creeping.","Counted your money twice. Still nothing.","Guy offers you work. You don't ask what kind."],
  hungry:  ["Church doing free meals. Pride vs hunger. Hunger wins.","Bodega owner tosses you a roll without eye contact. Real one."],
  blizzard:["Snow up to your knees. Nobody's out here but you and the cold.","Bodega's closed. Everything's closed. You're alone with the wind.","Your fingers are going numb. Need shelter fast."],
  rain:    ["Rain hammers the pavement. You pull your hood tight.","Puddles everywhere. Your socks are soaked.","Lightning hits somewhere close. The whole block goes quiet."],
  heatwave:["Concrete radiating heat like an oven. Sweat stinging your eyes.","Cop on every corner trying to look busy. Stay sharp.","Guy passed out on the stoop. This city'll kill you slow."],
};
const BOOT = [
  "> HOBO QUEST v1.0 — INITIALIZING",
  "> Loading borough data... Bronx. Brooklyn. Manhattan. Queens. Staten Island.",
  "> Syncing shared world... corners, crews, bounties, the dead.",
  "> Weather engine online... checking conditions.",
  "> Safe house registry loaded... 0 registered to your name.",
  "> Addiction engine online... everyone's running from something.",
  "> Cop presence data syncing... heat elevated across multiple boroughs.",
  "> NPC network loaded... Ray, Smoke, Dee, Rico, Marta. They remember everything.",
  "> WARNING: The Captain was last seen in Manhattan.",
  "> Persistent world active. What happened yesterday is still real today.",
  "> Nobody is looking for you here.",
  "> That's either freedom or a death sentence.",
  "> Choose who you are.",
];
const WORLD_KEY = "hq-world-v1";

// ── BACKSTORY SYSTEM ──────────────────────────────────────────────────────────
const BACKSTORY_QUESTIONS = [
  {
    id:"why",
    question:"Why are you out here?",
    options:[
      {id:"job",       label:"Lost everything when the job disappeared",    statMod:{hustle:1},        startBonus:{cash:20},  flavor:"You used to have a routine. An ID badge. A desk. That was before."},
      {id:"addiction", label:"The habit took the apartment, then the rest",  statMod:{charm:1},         startBonus:{},         flavor:"You know exactly how you got here. That's the hardest part."},
      {id:"family",    label:"Family fell apart and there was nowhere left",  statMod:{toughness:1},     startBonus:{},         flavor:"Some doors close and the people behind them don't open them again."},
      {id:"prison",    label:"Just got out. No address, no nothing",          statMod:{streetiq:1},      startBonus:{cash:10},  flavor:"Three years inside. The city moved on without asking if you were ready."},
      {id:"ran",       label:"Ran from something I can't talk about yet",     statMod:{heat:-1},         startBonus:{},         flavor:"You don't look back. Looking back is how they find you."},
      {id:"ancient",   label:"Ancient. Been on these streets longer than anyone knows", statMod:{charm:2,toughness:1}, startBonus:{},   flavor:"The city changes. You don't. That's the burden and the gift."},
    ]
  },
  {
    id:"left",
    question:"What did you leave behind?",
    options:[
      {id:"kid",      label:"A kid who doesn't know where I am",   mentalMod:-10, flavor:"There's a face you think about when things get bad. It's why you get back up."},
      {id:"career",   label:"A career I worked twenty years for",   mentalMod:-5,  flavor:"The corner office. The handshakes. Gone like it was never there."},
      {id:"nothing",  label:"Nothing worth mentioning",             mentalMod:5,   flavor:"Traveling light is a choice or a necessity. You've stopped knowing which."},
      {id:"secret",   label:"Something I need to go back and fix",  mentalMod:0,   flavor:"Unfinished business has a way of keeping you alive when nothing else does."},
      {id:"person",   label:"Someone I loved who couldn't follow",  mentalMod:-8,  flavor:"Not dead. Just gone the other direction. Sometimes that's worse."},
    ]
  },
  {
    id:"drive",
    question:"What keeps you going?",
    options:[
      {id:"survival",   label:"One more day. That's all I ask",          xpMult:1.0, flavor:"Survival is its own kind of ambition out here."},
      {id:"revenge",    label:"Someone put me here. I haven't forgotten", xpMult:1.1, fightBonus:1, flavor:"Anger is expensive fuel but it burns long."},
      {id:"redemption", label:"I need to make something right",           xpMult:1.0, mentalBonus:10, flavor:"The path back is longer than the fall. You've accepted that."},
      {id:"pride",      label:"I refuse to let this be the end of me",    xpMult:1.15, flavor:"Pride got you here. Pride might get you out."},
      {id:"people",     label:"People depending on me even now",          xpMult:1.0, crewBonus:true, flavor:"You carry more than your own weight. You always have."},
    ]
  },
];

// Generate journal entry for significant events
const JOURNAL_EVENTS = {
  firstFight:   (gs,result)=>`Day ${gs.day}: First fight${result==="win"?" — stood my ground":" — took the loss"}.`,
  firstCorner:  (gs,boro)=>`Day ${gs.day}: Claimed my first corner. ${getBoro(boro)?.name}. Mine now.`,
  firstCrew:    (gs,crew)=>`Day ${gs.day}: Joined ${crew}. Stopped being alone out here.`,
  levelUp:      (gs,lvl)=>`Day ${gs.day}: Reached Level ${lvl}. Still here. Still standing.`,
  death:        (gs)=>`Day ${gs.day}: This is where it ended. Level ${gs.level}.`,
  blizzard:     (gs)=>`Day ${gs.day}: Survived a blizzard. Barely. The cold out here is different.`,
  rareEvent:    (gs,title)=>`Day ${gs.day}: ${title}. The city keeps throwing things at you.`,
  shelter:      (gs,name)=>`Day ${gs.day}: Slept at ${name}. A real bed. Strange how much that means.`,
  prestige:     (gs)=>`Day ${gs.day}: Retired. Level ${gs.level}. Starting again. Different now.`,
  robbery:      (gs,name)=>`Day ${gs.day}: ${name} took from me. I won't forget.`,
  robbed:       (gs,name)=>`Day ${gs.day}: Took from ${name}. Necessary. That's what I tell myself.`,
  firstLetter:  (gs)=>`Day ${gs.day}: Wrote something down for the first time. Needed to say it.`,
  questStart:   (gs,title)=>`Day ${gs.day}: Took on a job. ${title}. Let's see where this goes.`,
  questDone:    (gs,title)=>`Day ${gs.day}: Finished what I started. ${title}. Felt good.`,
  questFail:    (gs,title)=>`Day ${gs.day}: Failed the job. ${title}. Some things don't go your way.`,
  firstSafe:    (gs,boro)=>`Day ${gs.day}: Secured a place in ${getBoro(boro)?.name}. Something that's mine.`,
  wanted:       (gs)=>`Day ${gs.day}: Went wanted. Heat maxed. Cops on every corner. Lying low.`,
  ghostMode:    (gs)=>`Day ${gs.day}: Vanished into the community. Sometimes invisible is the only safe.`,
  habitPaid:    (gs)=>`Day ${gs.day}: Kept up with the habit. One more day of keeping it together.`,
  habitMissed:  (gs)=>`Day ${gs.day}: Couldn't cover the habit. Body's paying the price now.`,
};
const charKey=(name,pin)=>`hq-char-${name.toLowerCase().replace(/\s+/g,"-")}-${pin}`;

// Stat growth per level by archetype — which stat gets the auto point
const LEVEL_STAT_GROWTH = {
  veteran:      ["toughness","toughness","hustle","streetiq","toughness","toughness","hustle","streetiq","toughness","charm"],
  schemer:      ["charm","streetiq","hustle","charm","streetiq","hustle","charm","streetiq","hustle","charm"],
  ghost:        ["streetiq","hustle","streetiq","toughness","hustle","streetiq","charm","hustle","streetiq","toughness"],
  hustler:      ["hustle","streetiq","hustle","charm","hustle","streetiq","hustle","charm","streetiq","hustle"],
  junkie:       ["charm","streetiq","charm","hustle","streetiq","charm","toughness","hustle","charm","streetiq"],
  undocumented: ["streetiq","hustle","charm","streetiq","toughness","hustle","streetiq","charm","hustle","streetiq"],
  schizo:       [
    {id:"pattern_recognition",name:"Pattern Recognition",level:1,cost:1,desc:"LOOK visions 30% more likely to yield real cash.",effect:{visionBonus:0.3}},
    {id:"voice_guidance",    name:"Voice Guidance",     level:2,cost:1,desc:"Chaos engine good outcomes increase by 10%.",         effect:{goodChaos:0.1}},
    {id:"unpredictable",     name:"Unpredictable",      level:3,cost:1,desc:"In combat: erratic movement. +2 attack, enemy -2 AC.", effect:{erraticCombat:true}},
    {id:"the_knowing",       name:"The Knowing",        level:4,cost:2,desc:"VISION command gives true player location once per day.",effect:{trueVision:true}},
    {id:"blessed_chaos",     name:"Blessed Chaos",      level:5,cost:2,desc:"Good chaos outcomes increase to 40% of chaos events.", effect:{blessedChaos:true}},
    {id:"street_prophet",    name:"Street Prophet",     level:6,cost:2,desc:"NPCs give you items or cash during TALK.",             effect:{prophetBonus:true}},
    {id:"beyond_fear",       name:"Beyond Fear",        level:7,cost:3,desc:"Cops hesitate. Wanted threshold effectively +2.",       effect:{fearless:true}},
    {id:"full_revelation",   name:"Full Revelation",    level:8,cost:3,desc:"At Shattered mental health, all stats +3.",            effect:{revelation:true}},
  ],
  drifter:      [
    {id:"good_boy",      name:"Good Boy",      level:1, cost:1, desc:"Dog gives +15 charm to all NPC interactions.",    effect:{charmBonus:2}},
    {id:"begging_eyes",  name:"Begging Eyes",  level:2, cost:1, desc:"PANHANDLE earns 50% more. People give to the dog.",effect:{panhandleBonus:0.5}},
    {id:"guard_dog",     name:"Guard Dog",     level:3, cost:1, desc:"GUARD command. Dog watches your stash while you sleep.",effect:{guardBonus:true}},
    {id:"dog_scout",     name:"Dog Scout",     level:4, cost:2, desc:"SCOUT DOG — dog runs ahead, returns with cop intel.", effect:{scoutBonus:true}},
    {id:"pack_bond",     name:"Pack Bond",     level:5, cost:2, desc:"Mental health never drops below 20 while your dog is with you.",effect:{mentalFloor:20}},
    {id:"street_vet",    name:"Street Vet",    level:6, cost:2, desc:"NPCs trust you faster. +1 rep per TALK.",            effect:{repBonus:1}},
    {id:"two_of_us",     name:"Two of Us",     level:7, cost:3, desc:"Dog joins combat. +3 attack, enemy -2 AC.",          effect:{dogCombat:true}},
    {id:"famous_dog",    name:"Famous Dog",    level:8, cost:3, desc:"Dog is famous. PANHANDLE earns 2x in home borough.", effect:{famousBonus:true}},
  ],
  vampire:      ["charm","toughness","charm","streetiq","toughness","charm","hustle","toughness","charm","streetiq"],
  fixer:        ["streetiq","charm","hustle","streetiq","charm","streetiq","hustle","charm","streetiq","hustle"],
  rat:          ["streetiq","streetiq","charm","hustle","streetiq","charm","streetiq","toughness","hustle","streetiq"],
};
// ── SHELTERS ─────────────────────────────────────────────────────────────────
const SHELTERS = {
  bronx:     {name:"BX Community Shelter", beds:12, curfew:20, rules:["No product","Sign in required"], borough:"bronx",    icon:"🏠"},
  brooklyn:  {name:"BK Mission",           beds:8,  curfew:21, rules:["No weapons","Sign in required"],  borough:"brooklyn",  icon:"🏠"},
  manhattan: {name:"Midtown Men's",        beds:6,  curfew:20, rules:["No product","No weapons"],        borough:"manhattan", icon:"🏠"},
  queens:    {name:"QNS Family Shelter",   beds:10, curfew:21, rules:["Families only — fake it"],        borough:"queens",    icon:"🏠"},
  staten:    {name:"SI Lighthouse",        beds:15, curfew:22, rules:["Easiest sign-in in the city"],    borough:"staten",    icon:"🏠"},
};
// Winter doubles capacity (day 270-365 and 0-90 proxy via day%365)
const shelterBeds=(bId,day)=>{const base=SHELTERS[bId]?.beds||8;const d=day%365;return(d<90||d>270)?base*2:base;};

// ── DAY LABOR JOBS ───────────────────────────────────────────────────────────
const DAY_LABOR_JOBS = [
  { id:"trucks",   name:"Loading Trucks",        location:"bronx",     pay:[45,65],  energy:55, heat:0,  desc:"Hunts Point market. 4am start. Cash in hand by noon. No ID required.",
    flavor:["The foreman hands you a number. You don't give your name. Nobody asks.",
            "Eight hours of boxes. Your back disagrees. Your wallet doesn't.",
            "The guys on the dock know you're not a regular. They don't care. You work, you get paid."],
    classBonus:{veteran:15, undocumented:-10}, failChance:0.05 },
  { id:"dishes",   name:"Washing Dishes",        location:"manhattan", pay:[35,50],  energy:45, heat:0,  desc:"Restaurant back kitchen. Cash at the end of the shift. No questions.",
    flavor:["You're invisible back here. That's fine. You prefer it.",
            "The chef doesn't speak much English. You don't either, in the ways that matter. You work well together.",
            "You eat whatever comes back from the tables. It's the best meal you've had all week."],
    classBonus:{schemer:-5, hustler:-5}, failChance:0.05 },
  { id:"moving",   name:"Moving Furniture",      location:"brooklyn",  pay:[55,80],  energy:65, heat:0,  desc:"Cash job off Craigslist. Two guys and a truck. You're the third guy.",
    flavor:["Four flights. No elevator. The couch doesn't fit. You make it fit.",
            "The family tips you an extra $20. The look on their face when you carry the refrigerator alone.",
            "You learn more about a stranger's life in three hours of moving their stuff than most people learn in years."],
    classBonus:{veteran:20, junkie:-15}, failChance:0.1,
    statCheck:{stat:"toughness",dc:4} },
  { id:"handyman", name:"Handyman Work",         location:"queens",    pay:[50,75],  energy:50, heat:0,  desc:"Painting, fixing, whatever needs doing. The building super pays cash.",
    flavor:["The tenant watches you work. Offers you lunch. You say yes.",
            "You fix three things that weren't on the list. The super notices. Says come back next week.",
            "Quiet work. Honest work. You forget for a few hours what you are out here."],
    classBonus:{fixer:20, veteran:10}, failChance:0.05 },
  { id:"demo",     name:"Demolition Crew",       location:"bronx",     pay:[60,90],  energy:70, heat:0,  desc:"Tearing down a building on Jerome. Day rate, cash, no paperwork.",
    flavor:["Sledgehammer work. Your arms will hurt tomorrow. The money's good.",
            "The foreman is running an unofficial operation. You don't ask. He doesn't tell.",
            "You find $40 in cash inside a wall you're tearing down. Nobody saw. It's yours."],
    classBonus:{veteran:25, junkie:-20}, failChance:0.1,
    statCheck:{stat:"toughness",dc:5} },
  { id:"delivery", name:"Food Delivery",         location:"manhattan", pay:[30,55],  energy:35, heat:0,  desc:"Someone's app, someone's bike. Deliver food, get paid per run. No ID.",
    flavor:["You learn every shortcut in Midtown in two hours.",
            "The tips are unpredictable. The people are indifferent. The movement is freeing.",
            "Nobody looks at you. That's either freedom or erasure. Today it feels like freedom."],
    classBonus:{ghost:15, hustler:10, rat:10}, failChance:0.05 },
  { id:"cleanup",  name:"Street Cleanup Crew",   location:"brooklyn",  pay:[40,55],  energy:45, heat:-1, desc:"City contractor. Orange vest, grabber stick. Paid daily, no ID for day workers.",
    flavor:["You wear the vest and suddenly nobody bothers you. It's like a costume.",
            "The foreman is a good guy. Tells you to come back tomorrow.",
            "Hard not to think about what the city throws away."],
    classBonus:{undocumented:15}, failChance:0.05 },
];

// ── BODEGA ITEMS ──────────────────────────────────────────────────────────────
const BODEGA_ITEMS = {
  coffee:     { name:"Coffee",          price:2,  desc:"Bodega coffee. Hot. Gets you moving.", effect:{energy:20,mental:5}, addictive:false },
  sandwich:   { name:"Sandwich",        price:6,  desc:"Deli sandwich. Real food.",             effect:{hunger:40,energy:10}, addictive:false },
  chips:      { name:"Chips",           price:2,  desc:"Bag of chips. Junk food hunger fix.",  effect:{hunger:15}, addictive:false },
  water:      { name:"Water",           price:1,  desc:"Bottled water. You need this.",        effect:{hunger:10,health:5}, addictive:false },
  beer:       { name:"Beer",            price:4,  desc:"40oz. Takes the edge off.",            effect:{warmth:10,mental:8,energy:-5}, addictive:true, substance:"alcohol" },
  cigarettes: { name:"Cigarettes",      price:5,  desc:"Pack of loosies. Mental reset.",      effect:{mental:10,health:-3}, addictive:true, substance:"cigarettes" },
  coffee_xl:  {name:"Large Coffee",    price:4,  desc:"Double cup. Night shift fuel.",        effect:{energy:35,mental:8}, addictive:false },
  soup:       { name:"Cup of Soup",     price:3,  desc:"Warm. Salt. Better than nothing.",     effect:{hunger:25,warmth:10}, addictive:false },
  metrocard:  { name:"MetroCard",       price:3,  desc:"Single ride. Gets you where you're going.", effect:{energy:0}, special:"transit", addictive:false },
  aspirin:    { name:"Aspirin",         price:3,  desc:"Dollar store bottle. Takes the edge off pain.", effect:{health:10,mental:5}, addictive:false },
  energydrink:{ name:"Energy Drink",   price:3,  desc:"It'll work. For a few hours.",         effect:{energy:40,health:-5}, addictive:false },
  hotdog:     { name:"Hot Dog",         price:2,  desc:"Street cart. Mustard. You know what you're getting.", effect:{hunger:20}, addictive:false },
};

// ── DYNAMIC NPC DIALOGUE ──────────────────────────────────────────────────────
// Additional dialogue lines unlocked by rep level
const NPC_DEEP_DIALOGUE = {
  ray: {
    5:  ["Ray tells you about his first winter on the street. 1987. 'The cold back then had opinions,' he says.",
         "'You know what I miss?' He doesn't wait for an answer. 'Having somewhere to put things. A shelf. A drawer.'",
         "He shows you a photograph. Old. Worn at the edges. A woman and a girl. He puts it away before you can ask."],
    8:  ["'I had a partner. Twenty-two years. She left six months before I ended up out here. I think about the timing sometimes.'",
         "Ray talks about the job he had. Something in logistics. 'I was good at it,' he says. 'That's the part that stays with you. When you're good at something and then you're not.'",
         "'My daughter writes,' he says. 'To this address I gave her. A friend of mine collects them. I read them when I can.' He looks at the river."],
    10: ["'You're going to make it,' Ray says. Not as comfort. As observation. 'I know what that looks like now. After all these years, I know.'",
         "'When you get out of this, don't look back at it like it didn't happen. It happened. Carry it differently.'"],
  },
  smoke: {
    5:  ["'I used to want to be a teacher,' Smoke says. He's not looking at you. 'Third grade. Something about that age.'",
         "'You know what the margins are on this? Terrible. I'm basically breaking even after overhead. But what overhead, right?' He laughs at his own joke.",
         "'Brooklyn changed,' Smoke says. 'Used to be you knew everyone on the block. Now I don't know half these people.'"],
    8:  ["'I got a son. Seven years old. Lives with his mother in Crown Heights. I drop money every week. She lets me see him sometimes.'",
         "'The thing about this work,' Smoke says, 'is you can't tell anyone what you actually do all day. So you're always lying. Even when you're not.'"],
    10: ["'I want out,' he says, quiet enough that you almost don't hear it. 'I've wanted out for three years. You know how that is.'"],
  },
  dee: {
    5:  ["'I've worked intake at three shelters,' Dee says. 'Families, then women's only, now this. Each one teaches you something different about what people need.'",
         "'We had a man stay here eighteen months once. Never left the borough. Finally got housing. Sends me a card every Christmas.'",
         "'The hardest part,' Dee says, 'is the paperwork. Not the people. The people I can do. The paperwork is designed to defeat you.'"],
    8:  ["'I burned out twice. Left this work completely. Both times something pulled me back. I don't know if that's a calling or a bad habit.'",
         "'I've thought about opening my own place. Something small. No rules about who can come in. No curfew. Just — a place.'"],
    10: ["'You've been out here a while now. I want you to know — what you've survived, that's not nothing. Most people don't have any idea.'"],
  },
  rico: {
    5:  ["'You think I like this?' Rico says. 'I'm doing what I know how to do. Same as everybody.'",
         "'My mother lives three blocks from here. She doesn't know. I keep it that way.'",
         "'Queens raised me,' Rico says. 'I owe it something. I just don't know what.'"],
    8:  ["'I had a deal once. Straight work, good money, uptown. Got passed over. White kid with a resume got it. That was the moment I understood something.'",
         "'I'm tired,' Rico says. Just that. He doesn't follow it up."],
    10: ["'You're one of the few people I actually trust out here. I don't say that for nothing.'"],
  },
  marta: {
    5:  ["'I was an ER nurse for eleven years,' Marta says. 'I left because I couldn't stomach what the system does to people who can't pay.'",
         "'I've set thirty-seven broken bones in the field. Never lost anyone to a break. The infections are what you have to watch.'",
         "'You'd be surprised what you can fix with what's available. The body wants to heal. You just have to give it a path.'"],
    8:  ["'I had a patient last year. Nineteen years old. Smart kid. In school. One bad winter and everything collapsed.' She's quiet for a moment. 'He's okay now. But it was close.'",
         "'I take home $0 from this. My husband doesn't complain anymore. He understands. Eventually people understand.'"],
    10: ["'Come see me anytime. Not just when you're hurt. Sometimes people just need someone to check on them.'"],
  },
};

// ── PANHANDLE outcomes by borough ─────────────────────────────────────────────
const PANHANDLE_BASE = {bronx:4,brooklyn:6,manhattan:14,queens:7,staten:5};
const PANHANDLE_MSGS = [
  "Office worker — midtown, headphones, not breaking stride — lets a folded bill fall from her hand as she passes. Doesn't look. You're grateful she didn't.",
  "Tourist from somewhere flat and landlocked stops, asks if you're okay, actually waits for an answer. Gives you a twenty. You tell him you'll be fine. You might be.",
  "Lady from the Baptist church three blocks over with a handmade sign and a stack of meal vouchers. No judgment in her eyes. Just a voucher and a nod.",
  "College kid, northface, airpods, walks past looking at his phone. Doesn't see you. You've learned that some people just don't have the circuitry for it.",
  "Delivery guy on a bike, $8-an-hour guy, hands you a ten without breaking pace. Some of the most generous people on the street are the ones who can least afford it.",
  "Man in a suit — expensive suit, the kind that means something — looks directly through you. Not with contempt. Worse. Just absence.",
  "Old woman stops. Doesn't give money. Sits next to you on the step and talks for ten minutes about her son who moved to Atlanta. When she leaves you feel less alone. That's worth something.",
  "Kid with a slice of pizza, still hot, holds it out to you like it's the most natural thing in the world. You take it.",
];
const PANHANDLE_FAIL = [
  "Security guard comes out of the building, apologetic, tells you this is private property. You go. He was just doing his job. So were you.",
  "You watch three people cross the street to avoid having to walk past you. You watch them do it. That's the part that stays with you.",
  "An hour on the same corner. Forty degrees. A few quarters. Your hands are numb and the math doesn't work and you have to stand up and keep moving anyway.",
  "Someone films you on their phone as they walk past. You turn your face. You've learned that.",
  "Block is dead today. Wrong corner, wrong hour, wrong everything. The city has moods and today's mood is indifference.",
];

// ── SEARCH / FOUND OBJECTS ────────────────────────────────────────────────────
const SEARCH_FINDS = [
  {type:"cash",    desc:"Jacket in the dumpster behind the dry cleaner. One pocket, $%v, crumpled like whoever lost it was in a hurry.",  value:[3,18]},
  {type:"cash",    desc:"$%v in quarters and dimes between the subway seats. You count it twice on the platform. People walk past. Nobody says anything.", value:[1,6]},
  {type:"cash",    desc:"Envelope taped under a bench in Riverside Park. $%v inside, no note. You don't ask questions.", value:[8,22]},
  {type:"food",    desc:"Restaurant kitchen door propped open, half a tray of rice and something left on the step. Still warm. You eat standing up in the alley.", value:[20,35]},
  {type:"food",    desc:"St. Anthony's running a side door operation — no signup, no sermon, just a sandwich and a cup of soup pressed into your hands by a woman who doesn't look at your face.", value:[15,25]},
  {type:"food",    desc:"Grocery store throwing out day-old bread, still bagged. Three loaves. You take two and leave one. Someone else needs it.", value:[25,40]},
  {type:"warmth",  desc:"Goodwill donation bag left on the corner, not yet picked up. Wool coat inside, barely worn, your size. Someone's old life. Your survival.", value:[20,30]},
  {type:"warmth",  desc:"Sleeping bag rolled up behind the ventilation unit on the roof of the parking structure. Someone's stash. You need it more right now.", value:[15,25]},
  {type:"gear",    desc:"Burner still in the box, sealed, sitting on top of a trash bag outside a Sprint store. Somebody's mistake. Your luck.",  item:"Burner Phone", value:null},
  {type:"gear",    desc:"Military-grade flashlight in a case under the overpass. Heavy. Works. Yours now.", item:"Zippo Lighter", value:null},
  {type:"product", desc:"Bag tucked in a specific crack in a specific wall that someone knew about. Either they forgot or they're not coming back.", product:"weed", qty:1, value:null},
  {type:"nothing", desc:"Someone got here first. You can tell by the disturbed trash, the way nothing of value is left. You're not the only one who knows these spots.", value:null},
  {type:"nothing", desc:"Three rats scatter when you move the cardboard. They look at you like you interrupted something. Maybe you did.", value:null},
  {type:"nothing", desc:"An hour of looking. Nothing. Some days the city gives you nothing and you just have to accept that and keep moving.", value:null},
  // Quest items findable via SEARCH
  {type:"questitem", desc:"A coil of thick rope behind the loading dock. Heavy duty. Could hold something important.", value:null, item:"Rope", prob:0.15},
  {type:"questitem", desc:"A waterproof dry bag — the kind kayakers use — left near the waterfront. Still sealed.", value:null, item:"Waterproof Bag", prob:0.1},
  {type:"questitem", desc:"Enough lumber and rope scraps near the Staten Island ferry terminal to build something. Something that might float.", value:null, item:"Raft Materials", prob:0.08, boroOnly:"staten"},
];

const rnd=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const getBoro=id=>BOROUGHS.find(b=>b.id===id);
const getLvl=xp=>LVL_XP.filter(t=>xp>=t).length;
const xpNext=xp=>{const l=getLvl(xp);return l>=LVL_XP.length?"MAX":LVL_XP[l]-xp;};
const mktPrice=(bId,pKey,day,weather,worldSupply)=>{
  const base=(getBoro(bId)?.base[pKey]||80)*(1+Math.sin(day*0.7+pKey.length)*0.15);
  const wMult=weather==="blizzard"?1.3:weather==="storm"?1.15:weather==="heatwave"?0.9:1;
  // Supply/demand: count sellers in borough from world supply data
  const sellers=(worldSupply?.[bId]?.[pKey]||0);
  const daysWithout=(worldSupply?.[`${bId}_${pKey}_drought`]||0);
  const demandMult=sellers>=MIN_SELL_PLAYERS?Math.max(0.6,1-(sellers-1)*DEMAND_DROP):1+(daysWithout*DEMAND_SPIKE);
  // Cop presence raises prices (risk premium)
  const copPresence=getBoro(bId)?.copBase||5;
  const copMult=1+(copPresence/50);
  return Math.round(base*wMult*demandMult*copMult);
};
const getWeather=day=>{
  const season=Math.floor((day%365)/91)%4;
  const pool=WEATHER_POOL[season];
  // deterministic per day so all players see same weather
  const idx=day%pool.length;
  return WEATHER_TYPES[pool[idx]];
};
const defWorld=()=>({corners:{},players:{},crews:{},messages:[],pvpLog:[],bounties:{},wallOfDead:[],playerAlerts:{},safehouses:{},weatherDay:0,weather:"clear",shelterCheckins:{},letters:[],worldHistory:[],notifications:[],copPresence:{},supply:{},captainBoro:null,captainDay:0,wantedTiers:{}});

// ── PRESTIGE ──────────────────────────────────────────────────────────────────
const PRESTIGE_LEVEL = 10; // level required to retire
const PRESTIGE_BUFFS = [
  {stat:"hustle",    amt:1, desc:"+1 permanent Hustle"},
  {stat:"streetiq",  amt:1, desc:"+1 permanent Street IQ"},
  {stat:"toughness", amt:1, desc:"+1 permanent Toughness"},
  {stat:"charm",     amt:1, desc:"+1 permanent Charm"},
];
const PRESTIGE_BADGES = ["🥉 Survivor","🥈 Veteran","🥇 Legend","💎 Ghost Legend","👑 Untouchable"];

// ── SKILL TREES (unique per archetype) ───────────────────────────────────────
const SKILL_TREES = {
  veteran: [
    { id:"iron_fists",   name:"Iron Fists",    level:2, cost:1, desc:"Fists count as weapons. Fight damage +3.",          effect:{fightBonus:3}},
    { id:"intimidate",   name:"Intimidate",    level:3, cost:1, desc:"INTIMIDATE command. Target loses 20% fight power.",   effect:{ability:"intimidate"}},
    { id:"endure",       name:"Endure",        level:4, cost:2, desc:"ENDURE command. Absorb next hit entirely. 1/day.",   effect:{ability:"endure"}},
    { id:"street_medic", name:"Street Medic",  level:5, cost:1, desc:"REST restores +15 extra health.",                   effect:{restHealthBonus:15}},
    { id:"warcry",       name:"War Cry",       level:6, cost:2, desc:"WARCRY command. Boost entire crew's fight power for 1 combat.", effect:{ability:"warcry"}},
    { id:"brawler",      name:"Brawler",       level:7, cost:2, desc:"Double fight damage. Can't be one-shot.",           effect:{fightMult:2, noOneShot:true}},
    { id:"hardened",     name:"Hardened",      level:8, cost:2, desc:"Toughness can exceed 10. Cap raised to 15.",        effect:{toughnessCap:15}},
    { id:"legend",       name:"Street Legend", level:9, cost:3, desc:"All NPCs start at 3-star rep. Crew gets +$30/day.", effect:{npcRepStart:3, crewBonus:30}},
  ],
  schemer: [
    { id:"silver_tongue", name:"Silver Tongue", level:2, cost:1, desc:"NPC talks unlock better deals. Buy price -10%.",   effect:{buyDiscount:0.1}},
    { id:"bluff",         name:"Bluff",         level:3, cost:1, desc:"BLUFF command. Sell product at 1.5x once/day.",    effect:{ability:"bluff"}},
    { id:"inside_man",    name:"Inside Man",    level:4, cost:2, desc:"SCOUT reveals cop patrol patterns. Heat risk -15%.",effect:{bustReduction:0.15}},
    { id:"network",       name:"The Network",   level:5, cost:1, desc:"NETWORK command. Call favor from any NPC anywhere.",effect:{ability:"network"}},
    { id:"money_launder", name:"Laundering",    level:6, cost:2, desc:"LAUNDER command. Convert heat -2 for $100.",       effect:{ability:"launder"}},
    { id:"kingpin",       name:"Kingpin",       level:7, cost:2, desc:"Corner income doubles. Bounties on you cost 2x.",  effect:{cornerMult:2}},
    { id:"ghost_ledger",  name:"Ghost Ledger",  level:8, cost:2, desc:"Product stash invisible to busts. Cops find nothing.",effect:{bustProofStash:true}},
    { id:"untouchable",   name:"Untouchable",   level:9, cost:3, desc:"Heat never triggers wanted above 8. Max effective heat 8.", effect:{heatCap:8}},
  ],
  ghost: [
    { id:"shadow_step",  name:"Shadow Step",   level:2, cost:1, desc:"SHADOW command. Move borough with zero heat cost.", effect:{ability:"shadow"}},
    { id:"case_em",      name:"Case Em",       level:3, cost:1, desc:"CASE command. See target stats before fighting.",   effect:{ability:"case"}},
    { id:"pickpocket",   name:"Pickpocket",    level:4, cost:2, desc:"PICKPOCKET command. Steal small cash, zero heat.",  effect:{ability:"pickpocket"}},
    { id:"invisible",    name:"Invisible",     level:5, cost:1, desc:"Other players can't see your location on their map.",effect:{invisible:true}},
    { id:"ghost_stash",  name:"Ghost Stash",   level:6, cost:2, desc:"SEARCH twice per day instead of once.",            effect:{searchPerDay:2}},
    { id:"slip_away",    name:"Slip Away",     level:7, cost:2, desc:"If busted, 50% chance to escape with product.",     effect:{bustEscape:0.5}},
    { id:"no_trace",     name:"No Trace",      level:8, cost:2, desc:"Attacking you costs attacker +3 heat instead of +2.",effect:{pvpHeatBack:3}},
    { id:"phantom",      name:"Phantom",       level:9, cost:3, desc:"VANISH upgraded. Drops heat by 5, full ghost mode.", effect:{vanishHeat:5}},
  ],
  hustler: [
    { id:"eye_for_deal",  name:"Eye For Deal",  level:2, cost:1, desc:"Buy price -5% extra. Sell price +5% extra.",       effect:{buyDiscount:0.05, sellBonus:0.05}},
    { id:"flip_master",   name:"Flip Master",   level:3, cost:1, desc:"FLIP shows cross-borough arbitrage opportunities.", effect:{ability:"flip_adv"}},
    { id:"front_credit",  name:"Front Credit",  level:4, cost:2, desc:"FRONT command. Buy product on credit, pay next day.",effect:{ability:"front"}},
    { id:"price_memory",  name:"Price Memory",  level:5, cost:1, desc:"Market prices shown for all boroughs at once.",    effect:{allPrices:true}},
    { id:"broker",        name:"The Broker",    level:6, cost:2, desc:"Set up trades between other players. Take 10% cut.",effect:{ability:"broker"}},
    { id:"monopoly",      name:"Monopoly",      level:7, cost:2, desc:"Owning 3+ corners gives +$50/day bonus.",          effect:{cornerBonus3:50}},
    { id:"hedge",         name:"Hedge",         level:8, cost:2, desc:"Keep 20% cash safe from robbery at all times.",    effect:{cashProtect:0.2}},
    { id:"empire",        name:"Empire",        level:9, cost:3, desc:"Safe house income triples. Crew bank earns 5%/day interest.", effect:{safeIncomeMult:3, crewInterest:0.05}},
  ],
  junkie: [
    { id:"street_cred",   name:"Street Cred",   level:2, cost:1, desc:"Habit makes you relatable. All charm checks +2.",  effect:{charmBonus:2}},
    { id:"score_plus",    name:"Score+",        level:3, cost:1, desc:"SCORE gets 2 bags instead of 1.",                  effect:{scoreQty:2}},
    { id:"junk_immunity", name:"Junk Immunity", level:4, cost:2, desc:"Health never drops from habit. Habit costs $10.",  effect:{habitImmune:true, habitCost:10}},
    { id:"hustle_high",   name:"Hustle High",   level:5, cost:1, desc:"After SCORE, next HUSTLE earns double.",           effect:{postScoreBonus:true}},
    { id:"connect_plus",  name:"Deep Connect",  level:6, cost:2, desc:"Junkie network: SCORE reveals police patrol timing.",effect:{scoreIntel:true}},
    { id:"redemption",    name:"Redemption",    level:7, cost:2, desc:"QUIT command. Break habit permanently. Mental +30, all stats +1.", effect:{ability:"quit"}},
    { id:"clean_slate",   name:"Clean Slate",   level:8, cost:2, desc:"After QUIT, prestige bonus doubled on retire.",    effect:{prestigeDouble:true}},
    { id:"survivor",      name:"Survivor",      level:9, cost:3, desc:"Can't die from habit or cold. Minimum 1 health.",  effect:{minHealth:1}},
  ],
  undocumented: [
    { id:"community_net", name:"Community Net", level:2, cost:1, desc:"CONNECT has 2 outcomes instead of 1.",             effect:{connectDouble:true}},
    { id:"ghost_id",      name:"Ghost ID",      level:3, cost:1, desc:"Fake papers. Can use shelters once/week.",         effect:{fakeId:true}},
    { id:"safe_routes",   name:"Safe Routes",   level:4, cost:2, desc:"Moving between boroughs costs 0 heat.",            effect:{moveNoHeat:true}},
    { id:"underground",   name:"Underground",   level:5, cost:1, desc:"Community passive income +$15/sleep.",             effect:{commBonus:15}},
    { id:"sanctuary",     name:"Sanctuary",     level:6, cost:2, desc:"Safe houses cost $200 instead of $500.",           effect:{safehouseCost:200}},
    { id:"invisible_man", name:"Invisible Man", level:7, cost:2, desc:"Cops never see you. Heat never rises above 5.",    effect:{heatCap:5}},
    { id:"network_boss",  name:"Network Boss",  level:8, cost:2, desc:"Your community tips affect all borough heat for all players.", effect:{communityHeatAura:true}},
    { id:"citizen",       name:"Citizen",       level:9, cost:3, desc:"APPLY command unlocked. Full social services access.", effect:{ability:"apply"}},
  ],
  fixer: [
    { id:"street_contacts", name:"Street Contacts", level:2, cost:1, desc:"All buy prices -10%. You know a guy who knows a guy.",         effect:{buyDiscount:0.1}},
    { id:"wire_transfer",   name:"Wire Transfer",   level:3, cost:1, desc:"WIRE [player] [amount] — send cash anonymously to anyone.",    effect:{ability:"wire"}},
    { id:"repair_kit",      name:"Repair Kit",      level:4, cost:2, desc:"REPAIR [player] — restore another player's gear durability.",  effect:{ability:"repair"}},
    { id:"inside_prices",   name:"Inside Prices",   level:5, cost:1, desc:"See all borough market prices simultaneously with MARKET.",    effect:{allPrices:true}},
    { id:"broker_fee",      name:"Broker Fee",      level:6, cost:2, desc:"BROKER [player1] [player2] — arrange a deal, take 10% cut.",   effect:{ability:"broker"}},
    { id:"network_map",     name:"Network Map",     level:7, cost:2, desc:"See every player's exact location on your map at all times.",  effect:{networkMap:true}},
    { id:"clean_slate",     name:"Clean Slate",     level:8, cost:2, desc:"CLEAN [player] — remove a player's wanted status for $200.",   effect:{ability:"clean"}},
    { id:"network_effect",  name:"Network Effect",  level:9, cost:3, desc:"Every player deal in the world generates you $5 automatically.", effect:{networkEffect:true}},
  ],
  rat: [
    { id:"cover_story",    name:"Cover Story",     level:2, cost:1, desc:"If exposed as rat, 50% chance heat spike cancels.",             effect:{coverStory:true}},
    { id:"handler_trust",  name:"Handler Trust",   level:3, cost:1, desc:"INFORM pays +$30 bonus. Handler protects you from 1 bust/day.", effect:{handlerBonus:30}},
    { id:"false_tip",      name:"False Tip",       level:4, cost:2, desc:"MISINFORM [player] — false tip drops their heat -2 (reverse rat).", effect:{ability:"misinform"}},
    { id:"double_agent",   name:"Double Agent",    level:5, cost:1, desc:"INFORM pays double. Your identity hidden for 3 more days.",     effect:{doubleAgent:true}},
    { id:"deep_cover",     name:"Deep Cover",      level:6, cost:2, desc:"You can't be attacked while in deep cover (active 1 day/week).", effect:{ability:"deepcover"}},
    { id:"plant",          name:"Plant",           level:7, cost:2, desc:"PLANT [player] — frame them. They get +3 heat, you get $80.",   effect:{ability:"plant"}},
    { id:"witness_prot",   name:"Witness Prot.",   level:8, cost:2, desc:"Emergency: PANIC command wipes all heat instantly. Once/life.", effect:{ability:"panic"}},
    { id:"turned",         name:"Turned",          level:9, cost:3, desc:"INTEL command — sell cop patrol info to any player. $50/tip.",  effect:{ability:"intel"}},
  ],
  vampire: [
    { id:"night_vision",  name:"Night Vision",    level:2, cost:1, desc:"SCOUT at night reveals enemy positions and product stashes.", effect:{nightScout:true}},
    { id:"mesmerize",     name:"Mesmerize",       level:3, cost:1, desc:"MESMERIZE [npc] — charm them into giving info, cash, or product.", effect:{ability:"mesmerize"}},
    { id:"blood_money",   name:"Blood Money",     level:4, cost:2, desc:"FEED heals 30hp instead of 15. Feeding income +$20.",           effect:{feedBonus:20,feedHeal:30}},
    { id:"mist_form",     name:"Mist Form",       level:5, cost:1, desc:"MIST command. Move borough with zero heat and zero energy cost.", effect:{ability:"mist"}},
    { id:"domination",    name:"Domination",      level:6, cost:2, desc:"DOMINATE [player] — force them to deposit $50 into your pocket. 1/day.", effect:{ability:"dominate"}},
    { id:"dark_lord",     name:"Dark Presence",   level:7, cost:2, desc:"All enemies attack you last in shared borough fights. Intimidate free.", effect:{darkPresence:true}},
    { id:"thrall",        name:"Thrall",          level:8, cost:2, desc:"THRALL [npc] — bind an NPC to you. They provide daily passive income $30.", effect:{ability:"thrall"}},
    { id:"ancient_blood", name:"Ancient Blood",   level:9, cost:3, desc:"Feeding restores full health. Can't be one-shot. Night income x3.",     effect:{ancientBlood:true, noOneShot:true}},
  ],
};

// ── EQUIPMENT SYSTEM ──────────────────────────────────────────────────────────
const EQUIPMENT_SLOTS = ["head","chest","hands","feet","weapon","accessory"];
const ITEM_RARITY = {
  common:    {name:"Common",    color:"#888",    prefix:""},
  uncommon:  {name:"Uncommon",  color:"#2a9d8f", prefix:""},
  rare:      {name:"Rare",      color:"#e9c46a", prefix:"★ "},
  legendary: {name:"Legendary", color:"#f4a261", prefix:"⚡ "},
};
const BASE_ITEMS = [
  // ── HEAD ──────────────────────────────────────────────────────────────────
  {id:"beanie",      name:"Wool Beanie",       slot:"head",      rarity:"common",    stats:{warmth:8},                       desc:"Keeps the cold out."},
  {id:"hood",        name:"Hoodie Hood",        slot:"head",      rarity:"common",    stats:{heat:-1},                        desc:"Hides your face."},
  {id:"cap",         name:"Fitted Cap",         slot:"head",      rarity:"uncommon",  stats:{charm:1},                        desc:"Clean look."},
  {id:"durag",       name:"Durag",              slot:"head",      rarity:"uncommon",  stats:{charm:1,hustle:1},               desc:"Fresh."},
  {id:"balaclava",   name:"Balaclava",          slot:"head",      rarity:"rare",      stats:{heat:-2,toughness:1},            desc:"Nobody clocks you."},
  {id:"snapback",    name:"Vintage Snapback",   slot:"head",      rarity:"uncommon",  stats:{charm:2},                        desc:"Turns heads."},
  {id:"do_rag",      name:"Weathered Do-Rag",   slot:"head",      rarity:"common",    stats:{warmth:4,hustle:1},              desc:"Years of use show."},
  {id:"hood_rare",   name:"Shadow Hood",        slot:"head",      rarity:"rare",      stats:{heat:-3,streetiq:1},             desc:"Disappear in plain sight."},
  {id:"crown",       name:"Five-Star Crown",    slot:"head",      rarity:"legendary", stats:{charm:3,streetiq:2,heat:-1},     desc:"Earned, not bought."},
  // ── CHEST ─────────────────────────────────────────────────────────────────
  {id:"tshirt",      name:"Plain White Tee",    slot:"chest",     rarity:"common",    stats:{},                               desc:"Nothing to see here."},
  {id:"hoodie",      name:"Gray Hoodie",        slot:"chest",     rarity:"common",    stats:{heat:-1,warmth:5},               desc:"Standard issue."},
  {id:"flannel",     name:"Flannel Shirt",      slot:"chest",     rarity:"common",    stats:{warmth:8},                       desc:"Keeps the chill off."},
  {id:"army_jkt",    name:"Army Jacket",        slot:"chest",     rarity:"uncommon",  stats:{toughness:2,warmth:6},           desc:"Thick canvas, thicker skin."},
  {id:"denim_jkt",   name:"Denim Jacket",       slot:"chest",     rarity:"uncommon",  stats:{toughness:1,charm:1},            desc:"Covered in patches."},
  {id:"leather",     name:"Leather Jacket",     slot:"chest",     rarity:"rare",      stats:{toughness:2,charm:2},            desc:"Respect on sight."},
  {id:"puffer",      name:"North Face Puffer",  slot:"chest",     rarity:"rare",      stats:{warmth:15,toughness:1},          desc:"Stolen from uptown."},
  {id:"vest",        name:"Kevlar Vest",         slot:"chest",     rarity:"legendary", stats:{toughness:4,noOneShot:true},    desc:"Stops a bullet. Barely."},
  {id:"trench",      name:"Black Trench Coat",  slot:"chest",     rarity:"rare",      stats:{charm:2,heat:-1,warmth:8},      desc:"Long. Dark. Memorable."},
  // ── HANDS ─────────────────────────────────────────────────────────────────
  {id:"bare",        name:"Bare Hands",          slot:"hands",     rarity:"common",    stats:{fightBonus:1},                  desc:"All you've got."},
  {id:"gloves",      name:"Work Gloves",         slot:"hands",     rarity:"common",    stats:{warmth:5,toughness:1},          desc:"Cracked leather."},
  {id:"latex",       name:"Latex Gloves",        slot:"hands",     rarity:"common",    stats:{bustReduction:0.05},            desc:"Leave no prints."},
  {id:"knuckles",    name:"Brass Knuckles",      slot:"hands",     rarity:"uncommon",  stats:{fightBonus:3},                  desc:"Old reliable."},
  {id:"wraps",       name:"Boxing Wraps",        slot:"hands",     rarity:"uncommon",  stats:{fightBonus:2,toughness:1},      desc:"Keeps your hands tight."},
  {id:"rings",       name:"Gold Rings",          slot:"hands",     rarity:"rare",      stats:{charm:2,fightBonus:2},          desc:"People notice."},
  {id:"sap_gloves",  name:"Sap Gloves",          slot:"hands",     rarity:"rare",      stats:{fightBonus:4,toughness:1},      desc:"Lead-weighted. Painful."},
  {id:"gauntlets",   name:"Street Gauntlets",    slot:"hands",     rarity:"legendary", stats:{fightBonus:5,toughness:2},      desc:"Armored. Intimidating."},
  // ── FEET ──────────────────────────────────────────────────────────────────
  {id:"beat_shoes",  name:"Beat-Up Sneakers",    slot:"feet",      rarity:"common",    stats:{hustle:0},                      desc:"Soles are giving out."},
  {id:"boots",       name:"Army Boots",           slot:"feet",      rarity:"common",    stats:{toughness:1,warmth:4},          desc:"Built to last."},
  {id:"slip_ons",    name:"Slip-On Vans",         slot:"feet",      rarity:"common",    stats:{hustle:1},                      desc:"Easy on, easy off."},
  {id:"sneakers",    name:"Clean Sneakers",       slot:"feet",      rarity:"uncommon",  stats:{charm:1,hustle:1},              desc:"Look the part."},
  {id:"timbs",       name:"Timberlands",          slot:"feet",      rarity:"rare",      stats:{toughness:2,hustle:1,warmth:5}, desc:"NYC standard."},
  {id:"running",     name:"Running Shoes",        slot:"feet",      rarity:"uncommon",  stats:{hustle:2,energy:5},             desc:"Fast when you need to be."},
  {id:"air_max",     name:"Air Max 95",            slot:"feet",      rarity:"legendary", stats:{hustle:2,charm:2,heat:-1},     desc:"Heads turn."},
  {id:"steel_toe",   name:"Steel-Toe Boots",      slot:"feet",      rarity:"rare",      stats:{toughness:3,fightBonus:1},     desc:"Kick differently."},
  // ── WEAPON ────────────────────────────────────────────────────────────────
  {id:"fists",       name:"Your Fists",           slot:"weapon",    rarity:"common",    stats:{fightBonus:0},                  desc:"What you were born with."},
  {id:"knife",       name:"Pocket Knife",         slot:"weapon",    rarity:"common",    stats:{fightBonus:2},                  desc:"Better than nothing."},
  {id:"box_cutter",  name:"Box Cutter",           slot:"weapon",    rarity:"common",    stats:{fightBonus:2,heat:1},           desc:"Fast and cheap."},
  {id:"bat",         name:"Aluminum Bat",          slot:"weapon",    rarity:"uncommon",  stats:{fightBonus:4,toughness:1},     desc:"Persuasive."},
  {id:"tire_iron",   name:"Tire Iron",             slot:"weapon",    rarity:"uncommon",  stats:{fightBonus:3,toughness:2},     desc:"Heavy. Effective."},
  {id:"chain",       name:"Heavy Chain",           slot:"weapon",    rarity:"rare",      stats:{fightBonus:5,intimidate:true},  desc:"The sound alone is a warning."},
  {id:"machete",     name:"Machete",               slot:"weapon",    rarity:"rare",      stats:{fightBonus:6,heat:1},           desc:"Nobody asks questions twice."},
  {id:"shooter",     name:"The Piece",             slot:"weapon",    rarity:"legendary", stats:{fightBonus:8,heat:2},           desc:"Changes everything. Heat too."},
  // ── ACCESSORY ─────────────────────────────────────────────────────────────
  {id:"burner",      name:"Burner Phone",          slot:"accessory", rarity:"common",    stats:{hustle:1},                     desc:"Stay connected."},
  {id:"lighter",     name:"Zippo Lighter",         slot:"accessory", rarity:"common",    stats:{warmth:2,charm:1},             desc:"Always useful."},
  {id:"notebook",    name:"Street Notebook",       slot:"accessory", rarity:"common",    stats:{streetiq:1},                   desc:"Write things down. Remember things."},
  {id:"scanner",     name:"Police Scanner",        slot:"accessory", rarity:"uncommon",  stats:{bustReduction:0.2},            desc:"Know before they know you know."},
  {id:"medkit",      name:"Basic Med Kit",         slot:"accessory", rarity:"uncommon",  stats:{healBonus:15},                 desc:"Patch yourself up."},
  {id:"ledger",      name:"Deal Ledger",           slot:"accessory", rarity:"rare",      stats:{hustle:2,streetiq:1},          desc:"Never forget a debt."},
  {id:"chain_acc",   name:"Cuban Link",            slot:"accessory", rarity:"legendary", stats:{charm:3,streetiq:1},           desc:"Speaks before you do."},
  {id:"flask",       name:"Ray's Flask",           slot:"accessory", rarity:"rare",      stats:{mental:10,warmth:5},           desc:"Given, not bought."},
  {id:"kit",         name:"Marta's Kit",           slot:"accessory", rarity:"rare",      stats:{healBonus:25,toughness:1},     desc:"Professional grade."},
  // ── CLASS-SPECIFIC ────────────────────────────────────────────────────────
  {id:"contact_bk",  name:"Contact Book",          slot:"accessory", rarity:"uncommon",  stats:{hustle:2,charm:1},             desc:"Everyone owes you something.", classes:["fixer"]},
  {id:"enc_phone",   name:"Encrypted Phone",       slot:"accessory", rarity:"rare",      stats:{hustle:2,streetiq:2,heat:-1},  desc:"Untraceable.", classes:["fixer","rat"]},
  {id:"recorder",    name:"Small Recorder",        slot:"accessory", rarity:"uncommon",  stats:{streetiq:2},                   desc:"Evidence.", classes:["rat"]},
  {id:"wire_cut",    name:"Wire Cutters",          slot:"hands",     rarity:"uncommon",  stats:{hustle:1,streetiq:1},          desc:"Get into places.", classes:["fixer"]},
  {id:"lock_picks",  name:"Lock Picks",            slot:"hands",     rarity:"uncommon",  stats:{streetiq:2,heat:-1},           desc:"Silent entry.", classes:["ghost","rat"]},
  {id:"sunglasses",  name:"Dark Sunglasses",       slot:"head",      rarity:"uncommon",  stats:{charm:1,heat:-1},              desc:"Nobody sees your eyes.", classes:["vampire"]},
  {id:"black_coat",  name:"Black Coat",            slot:"chest",     rarity:"rare",      stats:{charm:2,warmth:10,heat:-1},    desc:"Long. Midnight. Yours.", classes:["vampire"]},
  {id:"obsidian_r",  name:"Obsidian Ring",         slot:"accessory", rarity:"rare",      stats:{charm:2,warmth:5},             desc:"Ancient stone.", classes:["vampire"]},
  {id:"shadow_clk",  name:"Shadow Cloak",          slot:"chest",     rarity:"legendary", stats:{heat:-2,toughness:2,charm:1},  desc:"Darkness made fabric.", classes:["vampire","ghost"]},
  {id:"dog_tags",    name:"Dog Tags",              slot:"accessory", rarity:"uncommon",  stats:{toughness:1,mental:5},         desc:"Never take them off.", classes:["veteran"]},
  {id:"fake_id",     name:"Fake ID",               slot:"accessory", rarity:"uncommon",  stats:{heat:-1,charm:1},              desc:"Someone else's problem.", classes:["schemer","rat","undocumented"]},
  // ── OREGON TRAIL QUEST ITEMS ──────────────────────────────────────────────
  {id:"rope",        name:"Rope",                  slot:"accessory", rarity:"uncommon",  stats:{hustle:1},                     desc:"Heavy duty. Could hold a lot.", quest:true},
  {id:"wpbag",       name:"Waterproof Bag",         slot:"accessory", rarity:"rare",      stats:{},                             desc:"Keeps things dry. Crucial.", quest:true},
  {id:"raft_mat",    name:"Raft Materials",         slot:"accessory", rarity:"rare",      stats:{},                             desc:"Lashed together from whatever you could find. Probably fine.", quest:true},
  {id:"oregon_medal",name:"Oregon Trail Medal",     slot:"accessory", rarity:"legendary", stats:{charm:3,toughness:2,mental:20,hustle:2}, desc:"You forded the Hudson. Nobody believes you.", quest:true},
];

const getItemById=id=>BASE_ITEMS.find(i=>i.id===id);

// ── D&D COMBAT ENGINE ─────────────────────────────────────────────────────────
// Dice roller
const roll=(sides,count=1)=>Array.from({length:count},()=>Math.floor(Math.random()*sides)+1).reduce((a,b)=>a+b,0);
const rollStr=(sides,count=1)=>{const rolls=Array.from({length:count},()=>Math.floor(Math.random()*sides)+1);return{total:rolls.reduce((a,b)=>a+b,0),rolls};};

// Ability modifiers (D&D style: stat 1-10 → mod -2 to +4)
const mod=(stat)=>Math.floor((clamp(stat,1,10)-5)/2);

// Combat stats derived from character
const getCombatStats=(gs)=>{
  const eqStats=getItemStats(gs.equipment||{});
  const toughness=(gs.stats?.toughness||5)+(eqStats.toughness||0);
  const hustle=(gs.stats?.hustle||5)+(eqStats.hustle||0);
  const streetiq=(gs.stats?.streetiq||5)+(eqStats.streetiq||0);
  const fightBonus=(eqStats.fightBonus||0)+(gs.skills||[]).reduce((sum,sid)=>{
    const skill=Object.values(SKILL_TREES).flat().find(s=>s.id===sid);
    return sum+(skill?.effect?.fightBonus||0)+(skill?.effect?.fightMult?2:0);
  },0);
  return {
    ac: 10+mod(toughness),              // Armor Class
    hp: 10+toughness*2+gs.level*2,      // Max HP proxy
    attackBonus: mod(toughness)+mod(hustle)+fightBonus+Math.floor(gs.level/3),
    damageBonus: mod(toughness)+fightBonus,
    initiative: mod(hustle)+mod(streetiq),
    savingThrow: mod(toughness)+mod(streetiq),
    level: gs.level||1,
  };
};

// Enemy stat blocks by type
const ENEMIES = {
  thug:     {name:"Street Thug",   ac:10,hp:rnd(8,14),  attackBonus:2,damage:[4],  xp:15, loot:[10,25],
    desc:"Young, nothing to lose, running with whatever crew will have him."},
  dealer:   {name:"Rival Dealer",  ac:11,hp:rnd(10,16), attackBonus:3,damage:[6],  xp:20, loot:[20,50],
    desc:"Four years on this corner. He is not leaving. Neither are you."},
  enforcer: {name:"The Enforcer",  ac:13,hp:rnd(18,26), attackBonus:5,damage:[8],  xp:40, loot:[40,100],
    desc:"Six-two, two-forty, hands like sledgehammers. Collects debts for people you do not want to owe."},
  cop:      {name:"Plainclothes",  ac:14,hp:rnd(16,22), attackBonus:4,damage:[6],  xp:0,  loot:[0,0],
    desc:"Wrong shoes. Always the wrong shoes. Two blocks back. Now done watching."},
  kingpin:  {name:"The Kingpin",   ac:15,hp:rnd(30,40), attackBonus:7,damage:[10], xp:80, loot:[100,250],
    desc:"Controls three boroughs. Has not left this block in six months. Today is different."},
  boss_iceman:  {name:"Iceman",       ac:16,hp:rnd(45,60),attackBonus:8, damage:[12],xp:150,loot:[200,500],boss:true,special:"freeze",
    desc:"Former cartel logistics. Runs product through four boroughs without one arrest in eleven years.",
    intro:"A black Suburban pulls up. He steps out alone. He does not need backup.",
    winMsg:"You somehow got out of that. You will be talking about this for years.",
    fleeMsg:"Iceman watches you go with something that might be respect."},
  boss_duchess: {name:"The Duchess",  ac:15,hp:rnd(40,55),attackBonus:7, damage:[10],xp:130,loot:[150,400],boss:true,special:"counter",
    desc:"Runs the Bronx wholesale from a nail salon on 161st. Third-degree black belt. Absolutely no mercy.",
    intro:"She closes the ledger. You have been skimming from my supply chain. Not a question.",
    winMsg:"She went down. Powerful enemy made. Four hundred dollars gained.",
    fleeMsg:"She lets you go. That is almost more terrifying."},
  boss_prophet: {name:"The Prophet",  ac:14,hp:rnd(38,50),attackBonus:6, damage:[10],xp:120,loot:[100,300],boss:true,special:"inspire",
    desc:"Runs a crew through a storefront church. Has ordered actual hits. The contradiction does not bother him.",
    intro:"The Lord puts obstacles in our path for a reason. I am yours today.",
    winMsg:"You beat a man of God in a fistfight on the street. You will think about that.",
    fleeMsg:"Come back when you are ready. He means it."},
  boss_ghost:   {name:"Ghost",        ac:17,hp:rnd(35,48),attackBonus:9, damage:[8], xp:140,loot:[180,450],boss:true,special:"vanish",
    desc:"Nobody knows his real name. DEA has a file but no photo. Standing right in front of you.",
    intro:"You have something that belongs to someone I work for.",
    winMsg:"You beat someone the DEA could not catch. That will be your personality for a week.",
    fleeMsg:"He does not chase. He already knows where you sleep."},
  boss_mama:    {name:"Mama Rosario", ac:13,hp:rnd(42,55),attackBonus:6, damage:[9], xp:125,loot:[130,350],boss:true,special:"call_sons",
    desc:"Sixty-three. Runs Queens from her kitchen table. Her sons run street level. Decisions come from her.",
    intro:"She is outside in her housecoat at 11am. You put your hands on my son.",
    winMsg:"You got into a street fight with a grandmother and won. Take your money.",
    fleeMsg:"Run then. I know where you will be."},
  boss_cole:    {name:"Sgt. Cole",    ac:15,hp:rnd(40,52),attackBonus:8, damage:[11],xp:135,loot:[160,400],boss:true,special:"suppress",
    desc:"Two tours. Purple Heart. Could not find work when he got back. Now does the same thing here.",
    intro:"He sizes you up in two seconds. You are in the wrong place.",
    winMsg:"Fighting a combat veteran and coming out on top. Your hands are still shaking.",
    fleeMsg:"Smart. That is all."},
  boss_captain: {name:"The Captain",  ac:18,hp:rnd(60,80),attackBonus:10,damage:[14],xp:300,loot:[400,800],boss:true,special:"authority",
    desc:"Most decorated detective in the borough. Three commendations. Completely compromised. Watching you for weeks.",
    intro:"He flashes the badge. I think we need to have a conversation.",
    winMsg:"You beat a decorated NYPD detective. Heat max. Legend citywide. World knows by morning.",
    fleeMsg:"He lets you go. Every cop has your description."},
};
const getBossChance=(lv,heat)=>Math.min(0.25,(lv/10)*0.15+(heat/10)*0.1);
const BOSS_POOL=["boss_iceman","boss_duchess","boss_prophet","boss_ghost","boss_mama","boss_cole"];
const applyBossSpecial=(special,playerHp,enemyHp,log)=>{
  if(special==="freeze"&&Math.random()<0.3){log.push("Iceman freezes you. Skip this round.");return{playerHp,enemyHp,skip:true};}
  if(special==="counter"&&Math.random()<0.35){const d=rnd(4,8);log.push("Duchess counters: -"+d+"hp.");return{playerHp:Math.max(1,playerHp-d),enemyHp};}
  if(special==="inspire"&&enemyHp<30&&Math.random()<0.5){log.push("Prophet heals 8hp.");return{playerHp,enemyHp:enemyHp+8};}
  if(special==="vanish"&&Math.random()<0.25){log.push("Ghost vanishes. Attack misses.");return{playerHp,enemyHp,missedEnemy:true};}
  if(special==="call_sons"&&Math.random()<0.3){const d=rnd(6,12);log.push("Mama's sons hit for "+d+".");return{playerHp:Math.max(1,playerHp-d),enemyHp};}
  if(special==="suppress"&&Math.random()<0.4){log.push("Cole suppresses. Attack penalty.");return{playerHp,enemyHp,suppressed:true};}
  if(special==="authority"&&Math.random()<0.4){log.push("Captain's authority stops you cold.");return{playerHp,enemyHp,skip:true};}
  return{playerHp,enemyHp};
};

// Special abilities per archetype — usable in combat
const COMBAT_ABILITIES = {
  veteran:      [{id:"power_strike", name:"Power Strike",  cooldown:3, desc:"Strike hard. 2d8+STR damage.",       fn:(gs,enemy)=>{const r=rollStr(8,2);const dmg=r.total+mod(gs.stats?.toughness||5)+2;return{log:[`⚔ POWER STRIKE! Rolled ${r.rolls.join("+")}=${r.total}. +${mod(gs.stats?.toughness||5)+2} bonus. ${dmg} damage!`],enemyDmg:dmg,selfDmg:0};}},
                 {id:"endure_hit",   name:"Endure",        cooldown:5, desc:"Brace. Take half damage this round.", fn:(gs,enemy)=>{return{log:[`🛡 ENDURE activated. Damage halved this round.`],enemyDmg:0,selfDmg:0,halfDmg:true};}}],
  schemer:      [{id:"fast_talk",    name:"Fast Talk",     cooldown:3, desc:"Talk your way: enemy loses next attack.", fn:(gs,enemy)=>{return{log:[`💬 FAST TALK. ${enemy.name} is confused — skips next turn.`],enemyDmg:0,selfDmg:0,skipEnemyTurn:true};}},
                 {id:"sucker_punch", name:"Sucker Punch",  cooldown:4, desc:"Catch them off guard. 3d4 damage + stun.", fn:(gs,enemy)=>{const r=rollStr(4,3);const dmg=r.total+mod(gs.stats?.charm||5);return{log:[`🥊 SUCKER PUNCH! ${r.rolls.join("+")}=${r.total}. +${mod(gs.stats?.charm||5)} charm mod. ${dmg} damage. Stunned!`],enemyDmg:dmg,selfDmg:0,stunEnemy:true};}}],
  ghost:        [{id:"vanish_strike",name:"Vanish Strike",cooldown:3, desc:"Disappear, reappear behind them. 2d6 + advantage on next roll.", fn:(gs,enemy)=>{const r=rollStr(6,2);const dmg=r.total+mod(gs.stats?.streetiq||5);return{log:[`👻 VANISH STRIKE! Materialized from shadows. ${r.rolls.join("+")}=${r.total}. ${dmg} damage. Advantage next round.`],enemyDmg:dmg,selfDmg:0,advantage:true};}},
                 {id:"smoke_screen", name:"Smoke Screen",  cooldown:4, desc:"Blind them. Enemy attack penalty -4 for 2 rounds.", fn:(gs,enemy)=>{return{log:[`💨 SMOKE SCREEN. ${enemy.name} can't see. -4 to their attacks.`],enemyDmg:0,selfDmg:0,blindEnemy:true};}}],
  hustler:      [{id:"bribe",        name:"Bribe",         cooldown:3, desc:"Spend $30 to end combat immediately.",  fn:(gs,enemy)=>{return{log:[`💵 BRIBE. Slipped them $30. Fight's over.`],enemyDmg:0,selfDmg:0,endCombat:true,cashCost:30};}},
                 {id:"cheap_shot",   name:"Cheap Shot",    cooldown:4, desc:"Go low. 1d8 guaranteed hit, no AC check.", fn:(gs,enemy)=>{const r=rollStr(8,1);return{log:[`🎯 CHEAP SHOT! Auto-hit. Rolled ${r.total}. Hurts.`],enemyDmg:r.total,selfDmg:0,autoHit:true};}}],
  junkie:       [{id:"wild_swing",   name:"Wild Swing",    cooldown:2, desc:"Unpredictable. 1d12, high risk high reward.", fn:(gs,enemy)=>{const r=rollStr(12,1);const crit=r.total>=10;const dmg=crit?r.total*2:r.total>6?r.total:0;return{log:[`💉 WILD SWING! Rolled ${r.total}. ${crit?"CRITICAL! Double damage!":r.total>6?"Connects!":"Whiffs."} ${dmg} damage.`],enemyDmg:dmg,selfDmg:crit?0:r.total<4?8:0};}},
                 {id:"desperate",    name:"Desperate",     cooldown:5, desc:"All or nothing. If HP<30%, deal 4d6.", fn:(gs,enemy)=>{if((gs.survival?.health||100)>30){return{log:[`Need to be below 30% health for Desperate.`],enemyDmg:0,selfDmg:0};}const r=rollStr(6,4);return{log:[`🔥 DESPERATE! Nothing to lose. Rolled ${r.rolls.join("+")}=${r.total}. Unhinged.`],enemyDmg:r.total,selfDmg:0};}}],
  undocumented: [{id:"ghost_crowd",  name:"Ghost Crowd",   cooldown:3, desc:"Melt into bystanders. Enemy loses you — reset combat.", fn:(gs,enemy)=>{return{log:[`🌐 GHOST CROWD. You vanish into the crowd. Combat resets.`],enemyDmg:0,selfDmg:0,resetCombat:true};}},
                 {id:"community",    name:"Community",     cooldown:5, desc:"A stranger intervenes. Enemy stunned 2 rounds.", fn:(gs,enemy)=>{return{log:[`🤝 A stranger steps in. "${enemy.name}, leave them alone." Stunned 2 rounds.`],enemyDmg:0,selfDmg:0,stunEnemy:true,stunRounds:2};}}],
  fixer:        [{id:"bribe_out",    name:"Bribe Out",     cooldown:3, desc:"Pay enemy $20 to end combat. Always works.", fn:(gs,enemy)=>{return{log:[`🔧 BRIBE OUT. You hand them $20. "Not worth it." They walk.`],enemyDmg:0,selfDmg:0,endCombat:true,cashCost:20};}},
                 {id:"call_backup",  name:"Call Backup",   cooldown:5, desc:"Call a contact. Enemy flees immediately.", fn:(gs,enemy)=>{return{log:[`📱 CALL BACKUP. You make one call. ${enemy.name} doesn't want those problems. Gone.`],enemyDmg:0,selfDmg:0,endCombat:true,cashCost:0};}}],
  schizo:       [
    {id:"unhinged",  name:"Unhinged",  cooldown:2, desc:"Completely random attack. d4 to d20 — even you don't know.",
      fn:(gs,enemy)=>{const dice=[4,6,8,10,12,20];const d=dice[rnd(0,dice.length-1)];const r=rollStr(d,1);const crit=d===20;return{log:["🌀 UNHINGED! Rolling a d"+d+". "+r.total+" damage."+(crit?" NATURAL 20. The voices called it.":"")],enemyDmg:crit?r.total*2:r.total,selfDmg:0};}},
    {id:"rambling",  name:"Rambling",  cooldown:4, desc:"Talk at them for 3 minutes. So confusing they skip 2 turns.",
      fn:(gs,enemy)=>{return{log:["🌀 RAMBLING. You explain a seventeen-part theory. "+enemy.name+" genuinely cannot process this."],enemyDmg:0,selfDmg:0,stunEnemy:true,stunRounds:2};}},
  ],
  drifter:      [{id:"sic_em",    name:"Sic Em",     cooldown:3, desc:"Dog attacks. 1d8 guaranteed hit. Enemy distracted next round.", fn:(gs,enemy)=>{const r=rollStr(8,1);return{log:["🐕 Your dog launches. "+r.total+" damage. Enemy is rattled."],enemyDmg:r.total,selfDmg:0,autoHit:true,stunEnemy:true};}},
                 {id:"good_distraction",name:"Distraction",cooldown:4, desc:"Dog distracts. Enemy -4 to attack for 2 rounds. You attack free.",fn:(gs,enemy)=>{return{log:["🐕 Your dog barks and weaves. "+enemy.name+" loses track of you."],enemyDmg:0,selfDmg:0,blindEnemy:true,stunRounds:2};}}],
  rat:          [{id:"rat_out",      name:"Rat Out",       cooldown:3, desc:"Snitch mid-fight. Cops arrive. Enemy flees, you get heat +2.", fn:(gs,enemy)=>{return{log:[`🐀 RAT OUT. You call it in. ${enemy.name} scatters. Cops incoming.`],enemyDmg:0,selfDmg:0,endCombat:true,heatCost:2};}},
                 {id:"sucker_stab",  name:"Sucker Stab",   cooldown:4, desc:"Stab from behind. 3d4 guaranteed hit, no AC check.", fn:(gs,enemy)=>{const r=rollStr(4,3);return{log:[`🐀 SUCKER STAB! From behind. ${r.rolls.join("+")}=${r.total}. They didn't see it coming.`],enemyDmg:r.total,selfDmg:0,autoHit:true};}}],
  vampire:      [{id:"bite",         name:"Bite",          cooldown:3, desc:"Drain life. 2d6 damage, steal that HP for yourself.", fn:(gs,enemy)=>{const r=rollStr(6,2);const dmg=r.total+mod(gs.stats?.charm||5);const drain=Math.floor(dmg/2);return{log:[`🧛 BITE! Fangs in. ${r.rolls.join("+")}=${r.total}+${mod(gs.stats?.charm||5)} charm = ${dmg} damage dealt. +${drain}hp drained back to you.`],enemyDmg:dmg,selfDmg:-drain};}},
                 {id:"hypnosis",     name:"Hypnosis",      cooldown:4, desc:"Lock eyes. Enemy frozen for 2 rounds, -4 attack after.", fn:(gs,enemy)=>{return{log:[`👁 HYPNOSIS. Your eyes go black. ${enemy.name} freezes. Can't look away.`],enemyDmg:0,selfDmg:0,stunEnemy:true,stunRounds:2,blindEnemy:true};}}],
};

// ── TUTORIAL SYSTEM ───────────────────────────────────────────────────────────
const TUTORIAL_STEPS = [
  { id:"look",     trigger:"LOOK",     msg:"👋 Start here. Type LOOK to see what's around you.",                                        reward:null},
  { id:"status",   trigger:"STATUS",   msg:"Good. Now type STATUS to check your character.",                                             reward:null},
  { id:"hustle",   trigger:"HUSTLE",   msg:"You need cash. Type HUSTLE to work the block.",                                             reward:null},
  { id:"eat",      trigger:"EAT",      msg:"Keep your hunger up. Type EAT to grab food ($5).",                                          reward:{cash:10}},
  { id:"scout",    trigger:"SCOUT",    msg:"Know your market. Type SCOUT to check prices here.",                                        reward:null},
  { id:"buy",      trigger:"BUY",      msg:"Time to move product. Type BUY WEED 1 to grab a bag.",                                     reward:{cash:15}},
  { id:"sell",     trigger:"SELL",     msg:"Flip it. Type SELL WEED 1 to move it.",                                                    reward:null},
  { id:"shelter",  trigger:"SHELTER",  msg:"Stay safe tonight. Type SHELTER to find a bed.",                                           reward:null},
  { id:"skills",   trigger:"SKILLS",   msg:"You have skill points. Type SKILLS to see your tree.",                                     reward:{skillPoints:1}},
  { id:"sleep",    trigger:"SLEEP",    msg:"End your day. Type SLEEP to move to tomorrow.",                                            reward:{xp:25}},
  { id:"done",     trigger:null,       msg:"✓ Tutorial complete. You know enough to survive. Good luck out there.",                    reward:{cash:20}},
];
const getItemStats=(equipment)=>{
  // sum all equipped item stats
  const totals={};
  Object.values(equipment||{}).forEach(itemId=>{
    if(!itemId)return;
    const item=getItemById(itemId);
    if(!item)return;
    Object.entries(item.stats||{}).forEach(([k,v])=>{
      totals[k]=(totals[k]||0)+(typeof v==="boolean"?1:v);
    });
  });
  return totals;
};
const getEffectiveStat=(gs,stat)=>{
  const base=gs.stats?.[stat]||0;
  const eqBonus=getItemStats(gs.equipment)?.[stat]||0;
  const skillBonus=getSkillBonus(gs,stat);
  return base+eqBonus+skillBonus;
};
const getSkillBonus=(gs,stat)=>{
  if(!gs.skills)return 0;
  const tree=SKILL_TREES[gs.archetype?.id]||[];
  let bonus=0;
  gs.skills.forEach(sid=>{
    const skill=tree.find(s=>s.id===sid);
    if(skill?.effect?.[stat])bonus+=skill.effect[stat];
  });
  return bonus;
};
const hasSkill=(gs,skillId)=>(gs.skills||[]).includes(skillId);
const getSkillEffect=(gs,key)=>{
  if(!gs.skills)return null;
  const tree=SKILL_TREES[gs.archetype?.id]||[];
  for(const sid of (gs.skills||[])){
    const skill=tree.find(s=>s.id===sid);
    if(skill?.effect?.[key]!==undefined)return skill.effect[key];
  }
  return null;
};

// ── RARE EVENTS ───────────────────────────────────────────────────────────────
// ── MENTAL HEALTH STAGES ──────────────────────────────────────────────────────
const MENTAL_STAGES = [
  {min:80, max:100, name:"Stable",     color:"#2a9d8f", icon:"🧠", desc:"Clear-headed. Holding it together."},
  {min:60, max:79,  name:"Strained",   color:"#e9c46a", icon:"😟", desc:"The stress is showing. Keep moving."},
  {min:40, max:59,  name:"Fragile",    color:"#f4a261", icon:"😰", desc:"One bad day from the edge. Watch yourself."},
  {min:20, max:39,  name:"Breaking",   color:"#e63946", icon:"😖", desc:"Barely holding on. You need help."},
  {min:0,  max:19,  name:"Shattered",  color:"#9d4edd", icon:"💀", desc:"You are not okay. Nobody can see it but you."},
];
const getMentalStage=(m)=>MENTAL_STAGES.find(s=>m>=s.min&&m<=s.max)||MENTAL_STAGES[0];

// Mental health consequences by stage
const MENTAL_CONSEQUENCES = {
  strained: [
    "You snap at someone on the corner. They give you space. You regret it.",
    "Sleep didn't come easy. The thoughts are louder at night.",
    "You counted your cash three times. The number didn't change.",
  ],
  fragile: [
    "You spent $20 you couldn't afford on something you can't remember buying.",
    "You stood on the corner for an hour and didn't move any product. Just stood there.",
    "You got into it with someone over nothing. They walked away confused. So did you.",
    "You forgot what borough you were heading to. Just walked for a while.",
  ],
  breaking: [
    "You tried to make a deal and couldn't finish your sentences. They walked.",
    "You missed a corner window because you couldn't get off the stoop.",
    "Your hands shook so bad you dropped your product. Had to find it all.",
    "You sat in the dark for two hours and didn't notice the time passing.",
    "You called someone's name who isn't here anymore. Old habit.",
  ],
  shattered: [
    "You don't know what day it is. You stopped caring somewhere back there.",
    "You gave away $30 to someone who didn't ask for it. You're not sure why.",
    "You screamed at a cop car that wasn't moving. Then you ran.",
    "You woke up behind a dumpster on a block you don't recognize.",
    "The city feels like it's contracting. Getting smaller every day.",
  ],
};

// ── EXPANDED RARE EVENTS ──────────────────────────────────────────────────────
const RARE_EVENTS = [
  { id:"lawyer",    prob:0.04, title:"A Suit Steps Out of a Town Car",
    desc:"He's looking at you specifically. Not with contempt. With recognition. His firm does pro bono housing work. He thinks he can help.",
    choices:[
      {label:"Take his card",      fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+20)}}), outcome:"You take it. Don't know if you'll call. But you have it now."},
      {label:"Walk away",          fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)+5}}), outcome:"Felt right. Some things you're not ready for yet."},
    ]},
  { id:"wallet",    prob:0.05, title:"Someone Dropped a Wallet",
    desc:"Fat wallet. $200 minimum inside. License says Marcus Webb, Midtown address. Still warm from his pocket. He's maybe twenty yards ahead.",
    choices:[
      {label:"Keep it",            fn:(g)=>({...g,cash:g.cash+200,heat:clamp(g.heat+1,0,10)}), outcome:"$200. You needed it. Marcus Webb will cancel his cards by morning."},
      {label:"Turn it in",         fn:(g)=>({...g,cash:g.cash+20,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)}}), outcome:"Cop at the precinct gives you $20 finder's fee. Felt surprisingly good."},
      {label:"Return it yourself", fn:(g)=>({...g,cash:g.cash+50,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+25)}}), outcome:"Marcus gives you $50 and won't stop thanking you. You'll think about his face for days."},
    ]},
  { id:"oldcrew",   prob:0.04, title:"Someone From Before",
    desc:"You recognize the face before you can stop yourself. Old job. Old life. Old version of you. They slow down when they see you.",
    choices:[
      {label:"Talk to them",       fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+20)}}), outcome:"An hour of feeling human. Hard to put a price on that."},
      {label:"Keep walking",       fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-5}}), outcome:"They call your name. You don't turn around. Some doors you can't open again."},
    ]},
  { id:"medkit",    prob:0.06, title:"Church Van Running a First Aid Clinic",
    desc:"St. Anthony's mobile unit parked on the corner. Nurse asks no questions. She's seen worse. Probably today.",
    choices:[
      {label:"Get treated",        fn:(g)=>({...g,survival:{...g.survival,health:Math.min(100,g.survival.health+35),mental:Math.min(100,(g.survival.mental||70)+10)}}), outcome:"She patches you up properly. Doesn't charge. You feel almost human."},
      {label:"Move on",            fn:(g)=>g, outcome:"You've gotten this far without asking for help. Habit."},
    ]},
  { id:"eviction",  prob:0.04, title:"Clearing Day",
    desc:"City workers with notices. The spot under the overpass where six people sleep — they're moving everyone out. You know those people.",
    choices:[
      {label:"Help them move",     fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+10)}}), outcome:"You help carry what you can. Three people remember your name now."},
      {label:"Watch from a distance", fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-10}}), outcome:"You watch them scatter. That could be you tomorrow. It might be."},
    ]},
  { id:"windfall",  prob:0.03, title:"You Find Something",
    desc:"Behind a dumpster behind a restaurant. A bag. Sealed. You shake it. Something shifts inside.",
    choices:[
      {label:"Open it",            fn:(g)=>{const r=Math.random();return r>0.6?{...g,cash:g.cash+150}:r>0.3?{...g,product:{...g.product,weed:g.product.weed+3}}:{...g,survival:{...g.survival,health:clamp(g.survival.health-10,0,100)}};}, outcome:"Could be money. Could be product. Could be something you wish you hadn't opened."},
      {label:"Leave it",           fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)+5}}), outcome:"Some things aren't meant to be found. You keep moving."},
    ]},
  { id:"sickness",  prob:0.04, title:"You're Getting Sick",
    desc:"Started as a sore throat. Now it's everything. Your body is staging a revolt from the cold and the stress.",
    choices:[
      {label:"Push through",       fn:(g)=>({...g,survival:{...g.survival,health:clamp(g.survival.health-20,0,100),energy:clamp(g.survival.energy-30,0,100)}}), outcome:"You keep moving. Your body disagrees loudly."},
      {label:"Find somewhere warm", fn:(g)=>({...g,survival:{...g.survival,health:clamp(g.survival.health-5,0,100)}}), outcome:"You lose the day but gain some health back."},
    ]},
  { id:"letter_home", prob:0.03, title:"You Find a Pay Phone That Works",
    desc:"One of maybe twelve left in the city. You stand there. You know a number you haven't dialed in a long time.",
    choices:[
      {label:"Call",               fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+30)}}), outcome:"They pick up. You don't say much. They don't either. But they picked up."},
      {label:"Walk past",          fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-5}}), outcome:"You walk past. The number stays in your head all day."},
    ]},
  { id:"cop_harassment", prob:0.05, title:"Stop and Frisk",
    desc:"Two officers. You fit a description. They want to see ID, check your pockets. One of them finds something.",
    choices:[
      {label:"Comply",             fn:(g)=>({...g,heat:clamp(g.heat+2,0,10),product:{...g.product,weed:Math.max(0,g.product.weed-1)}}), outcome:"They take what they find. Write nothing down. Tell you to move along."},
      {label:"Know your rights",   fn:(g)=>({...g,heat:clamp(g.heat+1,0,10),survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+10)}}), outcome:"They're annoyed but they let you go. You carry yourself differently the rest of the day."},
    ]},
  { id:"overdose_witness", prob:0.04, title:"Someone's Down",
    desc:"On the sidewalk. Not sleeping. You know the difference. People are walking around them. Nobody's stopping.",
    choices:[
      {label:"Call 911",           fn:(g)=>({...g,heat:clamp(g.heat+1,0,10),survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)}}), outcome:"You call it in. They come. You're gone before they arrive. You think about it for days."},
      {label:"Stay with them",     fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+20),energy:clamp(g.survival.energy-20,0,100)}}), outcome:"You stay until the ambulance arrives. They make it."},
      {label:"Keep moving",        fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-20}}), outcome:"You keep moving. You tell yourself you couldn't have done anything. You don't fully believe it."},
    ]},
  { id:"job_offer",   prob:0.04, title:"A Line Cook Quits Mid-Shift",
    desc:"Restaurant back door propped open. Manager sweating, looking at his phone. He looks at you. 'You know how to wash dishes? Cash. Tonight only.'",
    choices:[
      {label:"Take the shift",     fn:(g)=>({...g,cash:g.cash+60,survival:{...g.survival,energy:clamp(g.survival.energy-40,0,100),hunger:Math.min(100,g.survival.hunger+30),mental:Math.min(100,(g.survival.mental||70)+10)}}), outcome:"$60 cash, a meal, four hours of feeling like a person with a job. Even if just for tonight."},
      {label:"Pass",               fn:(g)=>g, outcome:"You've got other plans. The manager finds someone else within the hour."},
    ]},
  { id:"community_meal", prob:0.05, title:"Block Association Cookout",
    desc:"Tables on the sidewalk. Rice, chicken, music. Someone waves you over without hesitation.",
    choices:[
      {label:"Join them",          fn:(g)=>({...g,survival:{...g.survival,hunger:Math.min(100,g.survival.hunger+50),mental:Math.min(100,(g.survival.mental||70)+25),energy:Math.min(100,g.survival.energy+15)}}), outcome:"You eat. You talk. You forget for an hour why you're out here. That's worth something."},
      {label:"Take a plate to go", fn:(g)=>({...g,survival:{...g.survival,hunger:Math.min(100,g.survival.hunger+30)}}), outcome:"You grab a plate. Keep moving. The food's good."},
    ]},
  { id:"robbery_target", prob:0.04, title:"Three Kids Step to You",
    desc:"Young. Maybe 17. They want what you have. All of them nervous. One keeps touching his jacket pocket.",
    choices:[
      {label:"Give them something", fn:(g)=>({...g,cash:Math.max(0,g.cash-40),survival:{...g.survival,mental:(g.survival.mental||70)+5}}), outcome:"$40 to make it not a situation. Cheaper than the alternative."},
      {label:"Stand your ground",  fn:(g)=>{const won=Math.random()>0.4;return won?{...g,survival:{...g.survival,health:clamp(g.survival.health-10,0,100)}}:{...g,cash:Math.max(0,g.cash-80),survival:{...g.survival,health:clamp(g.survival.health-25,0,100)}};}, outcome:"Whether that was smart depends on how it goes."},
    ]},
  { id:"mental_break",  prob:0.03, title:"Something Snaps",
    desc:"You can't name what triggered it. Just a moment where the weight of all of it lands at once. You sit down on the curb.",
    choices:[
      {label:"Sit with it",        fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+10),energy:clamp(g.survival.energy-20,0,100)}}), outcome:"You stay there a while. Let it pass. It does. You get up."},
      {label:"Push it down",       fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-15,energy:Math.min(100,g.survival.energy+10)}}), outcome:"You stuff it down and keep moving. Works for now."},
    ]},
  { id:"shelter_fire",  prob:0.02, title:"The Shelter Burned",
    desc:"Smoke on the horizon. The Bronx shelter caught fire overnight. Everyone got out. Barely.",
    choices:[
      {label:"Check on people",   fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)}}), outcome:"Everyone's okay. Shaken. Gathered on the sidewalk with everything they own."},
      {label:"Process it alone",  fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-5}}), outcome:"That was a safe place. Now it isn't. You file that and keep moving."},
    ]},
  { id:"found_phone",   prob:0.04, title:"Working Phone on a Bench",
    desc:"Cracked screen. 22% battery. Locked but emergency call still works. Worth $30 to the right person.",
    choices:[
      {label:"Sell it",           fn:(g)=>({...g,cash:g.cash+30}), outcome:"$30. Done."},
      {label:"Make a call first", fn:(g)=>({...g,cash:g.cash+20,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+20)}}), outcome:"Emergency calls go through. You make one you've been putting off. Then sell it for $20."},
    ]},
  { id:"veteran_moment", prob:0.02, title:"A Familiar Sound",
    desc:"A car backfires on 8th Avenue. You're on the ground before you know why. When you look up, someone's watching.",
    choices:[
      {label:"Get up, say nothing", fn:(g)=>({...g,survival:{...g.survival,mental:(g.survival.mental||70)-10}}), outcome:"You get up. Dust off. Keep walking. Nobody says anything. That's the worst part."},
      {label:"Talk to the stranger", fn:(g)=>({...g,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)}}), outcome:"He's a vet too. You talk for an hour. Exchange nothing but recognition. It helps."},
    ]},
];

// ── WORLD HISTORY entries ─────────────────────────────────────────────────────
const historyEntry=(type,actor,detail,boro)=>({type,actor,detail,boro,time:Date.now(),day:0});

// ── Components ─────────────────────────────────────────────────────────────────
function StatBar({label,value,max=10,color}){
  return <div style={{marginBottom:5}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,fontFamily:"'Share Tech Mono',monospace",color:"#bbb",marginBottom:2}}><span>{label}</span><span style={{color}}>{value}/{max}</span></div>
    <div style={{height:4,background:"#111",border:"1px solid #1a1a1a"}}><div style={{height:"100%",width:`${(value/max)*100}%`,background:`linear-gradient(90deg,${color}66,${color})`,boxShadow:`0 0 5px ${color}44`,transition:"width 0.4s"}}/></div>
  </div>;
}
function SrvBar({label,value,icon}){
  const c=value>60?"#2a9d8f":value>30?"#e9c46a":"#e63946";
  return <div style={{marginBottom:4}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,fontFamily:"'Share Tech Mono',monospace",color:"#444",marginBottom:2}}><span>{icon} {label}</span><span style={{color:c}}>{value}%</span></div>
    <div style={{height:3,background:"#111",border:"1px solid #161616"}}><div style={{height:"100%",width:`${value}%`,background:c,transition:"width 0.5s"}}/></div>
  </div>;
}
function WeatherBanner({weather,day}){
  const w=getWeather(day);
  const colors={clear:"#e9c46a",cloudy:"#888",rain:"#457b9d",fog:"#aaa",blizzard:"#a8dadc",heatwave:"#e63946",storm:"#8b5cf6"};
  return <div style={{padding:"4px 8px",background:`${colors[w.id]||"#333"}15`,border:`1px solid ${colors[w.id]||"#333"}33`,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <span style={{fontSize:12}}>{w.icon}</span>
      <div>
        <div style={{fontSize:8,color:colors[w.id]||"#888",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>{w.name.toUpperCase()}</div>
        <div style={{fontSize:7,color:"#444",fontFamily:"'Share Tech Mono',monospace"}}>{w.desc}</div>
      </div>
    </div>
    <div style={{fontSize:7,color:"#666",fontFamily:"'Share Tech Mono',monospace",textAlign:"right"}}>
      <div>BUST {w.bustMult<1?`-${Math.round((1-w.bustMult)*100)}%`:w.bustMult>1?`+${Math.round((w.bustMult-1)*100)}%`:"normal"}</div>
      {w.movePenalty>0&&<div style={{color:"#e9c46a"}}>MOVE -{w.movePenalty}E</div>}
    </div>
  </div>;
}
function SafePanel({gs,world,boro,onBuy,onUpgrade,onStash,onUnstash,onRest}){
  const myHouses=Object.entries(world.safehouses||{}).filter(([,s])=>s.owner===gs.name||s.crewOwner===gs.crew);
  const localHouse=world.safehouses?.[boro];
  const isMine=localHouse&&(localHouse.owner===gs.name||(gs.crew&&localHouse.crewOwner===gs.crew));
  const stashTotal=Object.values(localHouse?.stash||{}).reduce((a,b)=>a+b,0);
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// SAFE HOUSES</div>
    {/* Current borough */}
    <div style={{marginBottom:8,padding:"6px 8px",border:`1px solid ${isMine?"#e9c46a33":"#161616"}`,background:isMine?"#e9c46a05":"#090909"}}>
      <div style={{color:isMine?"#e9c46a":"#444",fontSize:9,marginBottom:3}}>{getBoro(boro)?.name} {isMine?"🏠":""}</div>
      {!localHouse&&<><div style={{color:"#333",fontSize:7,marginBottom:5}}>No safe house here. Cost: ${SAFEHOUSE_COST}</div>
        <div onClick={onBuy} style={{padding:"3px 8px",background:"#e9c46a15",border:"1px solid #e9c46a33",color:"#e9c46a",cursor:"pointer",fontSize:7,display:"inline-block"}}>BUY SAFEHOUSE</div></>}
      {localHouse&&!isMine&&<div style={{color:"#999",fontSize:7}}>Owned by {localHouse.owner||localHouse.crewOwner}. {localHouse.level>1?`Level ${localHouse.level}.`:""}</div>}
      {isMine&&<>
        <div style={{color:"#999",fontSize:7,marginBottom:4}}>Level {localHouse.level||1} · Heat drain: -{(localHouse.level||1)*0.5}/tick · Stash: {stashTotal} items</div>
        {/* stash contents */}
        {Object.entries(localHouse.stash||{}).filter(([,v])=>v>0).map(([k,v])=>(
          <div key={k} style={{fontSize:7,color:"#2a9d8f",marginBottom:1}}>{PRODUCTS[k]?.icon||"📦"} {k}: {v}</div>
        ))}
        <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
          {Object.entries(PRODUCTS).map(([key,p])=>gs.product[key]>0&&(
            <div key={key} onClick={()=>onStash(key)} style={{padding:"2px 5px",background:"#2a9d8f10",border:"1px solid #2a9d8f28",color:"#2a9d8f",cursor:"pointer",fontSize:7}}>STASH {p.icon}</div>
          ))}
          {Object.entries(localHouse.stash||{}).filter(([,v])=>v>0).map(([key])=>(
            <div key={`u${key}`} onClick={()=>onUnstash(key)} style={{padding:"2px 5px",background:"#e9c46a10",border:"1px solid #e9c46a28",color:"#e9c46a",cursor:"pointer",fontSize:7}}>GET {PRODUCTS[key]?.icon||"📦"}</div>
          ))}
          <div onClick={onRest} style={{padding:"2px 5px",background:"#45459910",border:"1px solid #454599",color:"#8888ff",cursor:"pointer",fontSize:7}}>REST HERE</div>
          {(localHouse.level||1)<3&&<div onClick={onUpgrade} style={{padding:"2px 5px",background:"#e9c46a10",border:"1px solid #e9c46a28",color:"#e9c46a",cursor:"pointer",fontSize:7}}>UPGRADE ${SAFEHOUSE_UPGRADE_COST}</div>}
        </div>
      </>}
    </div>
    {/* All owned */}
    {myHouses.length>0&&<><div style={{color:"#999",letterSpacing:2,marginBottom:4}}>// YOUR HOUSES</div>
    {myHouses.map(([bId,s])=><div key={bId} style={{display:"flex",justifyContent:"space-between",fontSize:7,marginBottom:2,padding:"3px 5px",border:"1px solid #161616",background:"#090909"}}>
      <span style={{color:"#e9c46a"}}>{getBoro(bId)?.short} 🏠 Lvl {s.level||1}</span>
      <span style={{color:"#2a9d8f"}}>{Object.values(s.stash||{}).reduce((a,b)=>a+b,0)} stashed</span>
    </div>)}</>}
    <div style={{color:"#999",fontSize:7,marginTop:6}}>CMD: BUY SAFEHOUSE · UPGRADE SAFEHOUSE · STASH [product] · UNSTASH [product] · REST SAFE</div>
  </div>;
}
function BoroMap({active,onSelect,world,weather,day}){
  const w=getWeather(day);
  return <div>
    <WeatherBanner weather={w.id} day={day}/>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginBottom:8}}>
      {BOROUGHS.map(b=>{
        const owned=world?.corners?.[b.id];const hasSafe=world?.safehouses?.[b.id];const copLvl=getCopPresence(b.id,world?.copPresence,0);
        return <div key={b.id} onClick={()=>onSelect(b.id)} style={{padding:"4px 6px",border:`1px solid ${active===b.id?b.color:"#191919"}`,background:active===b.id?`${b.color}10`:"#090909",cursor:"pointer",transition:"all 0.2s",boxShadow:active===b.id?`0 0 8px ${b.color}28`:"none"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:b.color,letterSpacing:1}}>{b.name}</div>
          <div style={{display:"flex",gap:4,marginTop:1,flexWrap:"wrap"}}>
            <span style={{fontSize:7,color:"#e63946"}}>🔥{b.heat}</span>
            <span style={{fontSize:7,color:"#2a9d8f"}}>💰{b.opp}</span>
            {owned&&<span style={{fontSize:7,color:b.color}}>▲{owned.slice(0,5)}</span>}
            {hasSafe&&<span style={{fontSize:7,color:"#e9c46a"}}>🏠</span>}
            <span style={{fontSize:7,color:copLvl>=8?"#e63946":copLvl>=5?"#e9c46a":"#333"}}>🚔{copLvl}</span>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
// ── CHARACTER PORTRAIT GENERATOR ─────────────────────────────────────────────
const RARITY_SYMBOL = {common:"·",uncommon:"◆",rare:"★",legendary:"⚡"};

// Archetype visual identity — emoji icon + accent pattern
const ARCH_IDENTITY = {
  veteran:      {icon:"🎖", pattern:"▓", eyes:"◉  ◉", mouth:"▽", tag:"COMBAT"},
  schemer:      {icon:"🃏", pattern:"░", eyes:"◈  ◈", mouth:"ω", tag:"DEALER"},
  ghost:        {icon:"🌫", pattern:"╌", eyes:"·  ·", mouth:"─", tag:"STEALTH"},
  hustler:      {icon:"💵", pattern:"═", eyes:"●  ●", mouth:"═", tag:"MONEY"},
  junkie:       {icon:"💉", pattern:"·", eyes:"×  ×", mouth:"___",tag:"HUSTLE"},
  undocumented: {icon:"🌐", pattern:"░", eyes:"○  ○", mouth:"─", tag:"GHOST"},
  vampire:      {icon:"🧛", pattern:"█", eyes:"◆  ◆", mouth:"▼", tag:"PREDATOR"},
  fixer:        {icon:"🔧", pattern:"─", eyes:"◎  ◎", mouth:"─", tag:"BROKER"},
  rat:          {icon:"🐀", pattern:"·", eyes:">  <", mouth:"^", tag:"SNITCH"},
};

function CharPortrait({gs}){
  const archId=gs.archetype?.id||"veteran";
  const color=gs.archetype?.color||"#e9c46a";
  const id=ARCH_IDENTITY[archId]||ARCH_IDENTITY.veteran;

  const weapon=gs.equipment?.weapon?getItemById(gs.equipment.weapon):null;
  const chest=gs.equipment?.chest?getItemById(gs.equipment.chest):null;
  const head=gs.equipment?.head?getItemById(gs.equipment.head):null;
  const acc=gs.equipment?.accessory?getItemById(gs.equipment.accessory):null;

  const hpPct=gs.survival.health;
  const mpPct=gs.survival.mental||70;
  const hpColor=hpPct>60?"#2a9d8f":hpPct>30?"#e9c46a":"#e63946";
  const mpColor=mpPct>60?"#8b5cf6":mpPct>30?"#e9c46a":"#e63946";

  const prestigeStr=gs.prestige>0?PRESTIGE_BADGES[Math.min(gs.prestige-1,PRESTIGE_BADGES.length-1)]:"";

  return (
    <div style={{background:`${color}08`,border:`1px solid ${color}44`,fontFamily:"'Share Tech Mono',monospace"}}>
      {/* Header strip */}
      <div style={{background:`${color}18`,padding:"5px 8px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${color}33`}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:18}}>{id.icon}</span>
          <div>
            <div style={{color,fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,lineHeight:1}}>{gs.name}</div>
            <div style={{color:`${color}88`,fontSize:7,letterSpacing:1}}>{gs.archetype?.name}{gs.title?` · ${gs.title}`:""}{gs.isDrifter&&gs.dogName?` 🐕 ${gs.dogName}`:""}</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{color,fontSize:7,letterSpacing:1,border:`1px solid ${color}44`,padding:"1px 5px",marginBottom:2}}>{id.tag}</div>
          {prestigeStr&&<div style={{fontSize:7,color:"#e9c46a"}}>{prestigeStr}</div>}
        </div>
      </div>
      {/* Face — simple clean emoji-based face using divs */}
      <div style={{padding:"8px",textAlign:"center",borderBottom:`1px solid ${color}22`}}>
        <div style={{
          display:"inline-block",
          width:64,height:64,
          borderRadius:4,
          background:`${color}10`,
          border:`1px solid ${color}33`,
          position:"relative",
          overflow:"hidden",
        }}>
          {/* Big archetype icon centered */}
          <div style={{fontSize:36,lineHeight:"64px",textAlign:"center",filter:`drop-shadow(0 0 6px ${color})`}}>{id.icon}</div>
          {/* Level badge */}
          <div style={{position:"absolute",bottom:2,right:2,background:color,color:"#000",fontSize:7,fontFamily:"'Bebas Neue',sans-serif",padding:"0 3px",letterSpacing:1}}>Lv{gs.level}</div>
          {/* Status overlay */}
          {gs.wanted&&<div style={{position:"absolute",top:2,left:2,background:"#e63946",color:"#fff",fontSize:6,padding:"0 2px"}}>HOT</div>}
          {gs.isVampire&&!gs.feedUsed&&<div style={{position:"absolute",top:2,left:2,background:"#9d4edd",color:"#fff",fontSize:6,padding:"0 2px"}}>HUN</div>}
          {gs.isRat&&gs.exposedAsRat&&<div style={{position:"absolute",top:2,left:2,background:"#ff6b6b",color:"#fff",fontSize:6,padding:"0 2px"}}>EXP</div>}
        </div>
      </div>
      {/* HP / Mental */}
      <div style={{padding:"5px 8px",borderBottom:`1px solid ${color}22`}}>
        <div style={{marginBottom:3}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#444",marginBottom:1}}><span>HP</span><span style={{color:hpColor}}>{hpPct}%</span></div>
          <div style={{height:4,background:"#111",borderRadius:1}}><div style={{height:"100%",width:`${hpPct}%`,background:hpColor,borderRadius:1,transition:"width 0.4s"}}/></div>
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#444",marginBottom:1}}><span>MND</span><span style={{color:mpColor}}>{mpPct}%</span></div>
          <div style={{height:4,background:"#111",borderRadius:1}}><div style={{height:"100%",width:`${mpPct}%`,background:mpColor,borderRadius:1,transition:"width 0.4s"}}/></div>
        </div>
      </div>
      {/* Gear summary */}
      <div style={{padding:"5px 8px",fontSize:7}}>
        {[head,chest,weapon,acc].filter(Boolean).map((item,i)=>(
          <div key={i} style={{color:ITEM_RARITY[item.rarity]?.color||"#666",marginBottom:1,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
            {RARITY_SYMBOL[item.rarity]} {item.name}
          </div>
        ))}
        {!head&&!chest&&!weapon&&!acc&&<div style={{color:"#666"}}>No gear equipped</div>}
      </div>
    </div>
  );
}

function InvGrid({items,equipment,onEquip}){
  // Merge inventory strings with equipped item names for display
  const equippedNames=Object.values(equipment||{}).filter(Boolean).map(id=>{const i=getItemById(id);return i?.name;}).filter(Boolean);
  return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:2}}>
    {(items||[]).map((item,i)=>{
      const baseItem=BASE_ITEMS.find(b=>b.name===item||b.id===item);
      const rar=baseItem?ITEM_RARITY[baseItem.rarity]:null;
      const isEquipped=equippedNames.includes(item);
      return <div key={i} onClick={()=>baseItem&&onEquip&&onEquip(baseItem)} style={{
        height:38,border:`1px solid ${isEquipped?rar?.color||"#2a9d8f":rar?`${rar.color}44`:"#1a1a1a"}`,
        background:isEquipped?`${rar?.color||"#2a9d8f"}15`:baseItem?"#0f0f0f":"#080808",
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
        fontSize:6,fontFamily:"'Share Tech Mono',monospace",
        color:isEquipped?rar?.color||"#2a9d8f":rar?.color||"#666",
        textAlign:"center",padding:2,lineHeight:1.3,cursor:baseItem?"pointer":"default",
      }}>
        {baseItem&&<div style={{fontSize:8,marginBottom:1}}>{RARITY_SYMBOL[baseItem.rarity]||"·"}</div>}
        <div>{item||"·"}</div>
        {isEquipped&&<div style={{fontSize:5,color:rar?.color||"#2a9d8f"}}>EQP</div>}
      </div>;
    })}
  </div>;
}
function MktPanel({bId,day,prod,setProd,qty,setQty,onBuy,onSell,playerProd,weather}){
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// MARKET — {getBoro(bId)?.short}</div>
    {Object.entries(PRODUCTS).map(([key,p])=>{
      const sp=mktPrice(bId,key,day,weather?.id),bp=Math.round(sp*p.bm);
      return <div key={key} onClick={()=>setProd(key)} style={{padding:"4px 6px",marginBottom:2,cursor:"pointer",border:`1px solid ${prod===key?"#e9c46a22":"#161616"}`,background:prod===key?"#e9c46a06":"transparent"}}>
        <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:prod===key?"#e9c46a":"#444"}}>{p.icon} {p.name}</span><span style={{color:"#2a9d8f"}}>${sp}</span></div>
        <div style={{color:"#999",fontSize:7,marginTop:1}}>Buy ${bp} · Have: {playerProd?.[key]||0}</div>
      </div>;
    })}
    {Object.entries(RECIPES).map(([name,r])=><div key={name} style={{fontSize:7,color:"#1e4e42",marginBottom:2,padding:"2px 4px",border:"1px solid #0e1e1a"}}>{r.icon} {name}: {r.desc}</div>)}
    <div style={{display:"flex",gap:4,marginTop:8,alignItems:"center"}}>
      <input type="number" min={1} max={20} value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))} style={{width:32,background:"#111",border:"1px solid #252525",color:"#e9c46a",fontFamily:"'Share Tech Mono',monospace",fontSize:9,padding:"2px 4px",outline:"none"}}/>
      <div onClick={onBuy}  style={{flex:1,padding:"4px 0",background:"#e9c46a10",border:"1px solid #e9c46a28",color:"#e9c46a",textAlign:"center",cursor:"pointer",fontSize:8}}>BUY</div>
      <div onClick={onSell} style={{flex:1,padding:"4px 0",background:"#2a9d8f10",border:"1px solid #2a9d8f28",color:"#2a9d8f",textAlign:"center",cursor:"pointer",fontSize:8}}>SELL</div>
    </div>
  </div>;
}
function NpcPanel({npcs,bId,onTalk}){
  const local=npcs.filter(n=>n.b===bId);
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// CONTACTS — {getBoro(bId)?.short}</div>
    {local.length===0&&<div style={{color:"#666"}}>No contacts here.</div>}
    {local.map(n=><div key={n.id} onClick={()=>onTalk(n)} style={{padding:"5px 6px",marginBottom:3,border:"1px solid #161616",background:"#090909",cursor:"pointer"}}>
      <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#777"}}>{n.icon} {n.name}</span><span style={{color:n.rep>5?"#2a9d8f":n.rep>0?"#e9c46a":"#252525"}}>{n.rep>0?"★".repeat(Math.min(n.rep,5)):"·····"}</span></div>
      <div style={{color:"#999",fontSize:7,marginTop:1}}>{n.role}</div>
    </div>)}
  </div>;
}
function CrewPanel({gs,world,onJoin}){
  const myCrew=gs.crew?world.crews?.[gs.crew]:null;
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// CREWS</div>
    {gs.crew&&myCrew&&<div style={{border:"1px solid #e9c46a33",padding:"6px 8px",marginBottom:8,background:"#e9c46a05"}}>
      <div style={{color:"#e9c46a",fontSize:9,marginBottom:2}}>{gs.crew} <span style={{color:"#999",fontSize:7}}>· {gs.crewRole}</span></div>
      <div style={{color:"#999",fontSize:7,marginBottom:1}}>Members: {myCrew.members.join(", ")}</div>
      <div style={{color:"#2a9d8f",fontSize:7}}>Bank: ${myCrew.bank||0}</div>
    </div>}
    {!gs.crew&&<div style={{color:"#333",fontSize:7,marginBottom:8}}>FORM CREW [name] or JOIN CREW [name]</div>}
    <div style={{color:"#999",letterSpacing:2,marginBottom:4}}>// ALL CREWS</div>
    {Object.keys(world.crews||{}).length===0&&<div style={{color:"#191919"}}>No crews yet.</div>}
    {Object.entries(world.crews||{}).map(([name,crew])=><div key={name} style={{padding:"4px 6px",border:"1px solid #161616",marginBottom:3,background:"#090909"}}>
      <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:gs.crew===name?"#e9c46a":"#555"}}>{name}</span><span style={{color:"#2a9d8f",fontSize:7}}>${crew.bank||0}</span></div>
      <div style={{color:"#999",fontSize:7,marginTop:1}}>{crew.members.length}m · {crew.founder}</div>
      {gs.crew!==name&&<div onClick={()=>onJoin(name,crew)} style={{color:"#2a9d8f",fontSize:7,marginTop:2,cursor:"pointer"}}>→ join</div>}
    </div>)}
    <div style={{color:"#555",letterSpacing:2,margin:"8px 0 4px"}}>// WALL OF DEAD</div>
    {(world.wallOfDead||[]).length===0&&<div style={{color:"#191919"}}>Nobody dead yet.</div>}
    {(world.wallOfDead||[]).slice(-5).reverse().map((d,i)=><div key={i} style={{fontSize:7,color:"#3a2020",marginBottom:2}}>☠ {d.name} · Lvl {d.level} · Day {d.day}</div>)}
  </div>;
}

// ── Main ───────────────────────────────────────────────────────────────────────
// ── Quest Panel Component ─────────────────────────────────────────────────────
function QuestPanel({gs,npcs,onAccept,onComplete,onAbandon,boro}){
  const available=getAvailableQuests(gs,npcs);
  const active=getActiveQuests(gs);
  const done=(gs.completedQuests||[]);
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// QUESTS</div>

    {/* active quests */}
    {active.length>0&&<>
      <div style={{fontSize:7,color:"#e9c46a",letterSpacing:1,marginBottom:4}}>ACTIVE ({active.length})</div>
      {active.map(q=>{
        const daysLeft=Math.max(0,(q.startDay||0)+(q.duration||3)-gs.day);
        const urgent=daysLeft<=1;
        return <div key={q.id} style={{marginBottom:6,padding:"5px 7px",border:`1px solid ${urgent?"#e63946":"#e9c46a"}33`,background:urgent?"#e6394605":"#e9c46a05"}}>
          <div style={{color:urgent?"#e63946":"#e9c46a",fontSize:8,marginBottom:2}}>{q.title}</div>
          <div style={{color:"#888",fontSize:7,marginBottom:3,lineHeight:1.4}}>{q.task}</div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:7}}>
            <span style={{color:urgent?"#e63946":"#555"}}>{daysLeft}d left</span>
            <div style={{display:"flex",gap:6}}>
              <span onClick={()=>onComplete(q.npc,q.tier)} style={{color:"#2a9d8f",cursor:"pointer"}}>complete</span>
              <span onClick={()=>onAbandon(q.npc,q.tier)} style={{color:"#e63946",cursor:"pointer"}}>abandon</span>
            </div>
          </div>
        </div>;
      })}
    </>}

    {/* available quests */}
    {available.length>0&&<>
      <div style={{fontSize:7,color:"#2a9d8f",letterSpacing:1,marginBottom:4,marginTop:active.length>0?8:0}}>AVAILABLE</div>
      {available.map(q=>{
        const npc=npcs.find(n=>n.id===q.npc);
        return <div key={q.id} style={{marginBottom:5,padding:"5px 7px",border:"1px solid #161616",background:"#090909"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
            <span style={{color:"#bbb",fontSize:8}}>{npc?.icon} {npc?.name}</span>
            <span style={{fontSize:7,color:"#666"}}>Tier {q.tier}</span>
          </div>
          <div style={{color:"#e9c46a",fontSize:8,marginBottom:2}}>{q.title}</div>
          <div style={{color:"#888",fontSize:7,marginBottom:4,lineHeight:1.4,fontStyle:"italic"}}>{q.briefing.slice(0,80)}...</div>
          <div onClick={()=>onAccept(q.npc,q.tier)} style={{fontSize:7,color:"#2a9d8f",cursor:"pointer",padding:"2px 0"}}>→ ACCEPT</div>
        </div>;
      })}
    </>}

    {active.length===0&&available.length===0&&<>
      <div style={{color:"#888",fontSize:8,marginBottom:6}}>No quests available right now.</div>
              {gs?.level>=8&&(gs?.completedQuests||[]).includes("ray_q3")&&!(gs?.completedQuests||[]).includes("ray_secret_q1")&&!(gs?.activeQuests||{})["ray_secret_q1"]&&(
                <div style={{marginTop:8,padding:"5px 7px",border:"1px solid #e9c46a22",background:"#e9c46a05",fontSize:7,color:"#e9c46a88",fontStyle:"italic"}}>
                  💡 Ray has been quiet lately. Something about the Oregon Trail. ACCEPT RAY 4.
                </div>
              )}
      <div style={{color:"#999",fontSize:7,lineHeight:1.6}}>Build rep by talking to NPCs.
Each NPC has 3 quest tiers.
Min rep: 2 / 5 / 8 per tier.</div>
      <div style={{marginTop:8,color:"#999",fontSize:7}}>Completed: {done.length} quests total</div>
    </>}

    <div style={{marginTop:8,fontSize:7,color:"#555",borderTop:"1px solid #111",paddingTop:5}}>QUESTS · ACCEPT [npc] [tier] · COMPLETE [npc] [tier]</div>
  </div>;
}

// ── Skill Tree Panel Component ───────────────────────────────────────────────
function SkillPanel({gs,onUnlock}){
  const tree=SKILL_TREES[gs.archetype?.id]||[];
  const arch=gs.archetype;
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:4}}>// {arch?.name} SKILLS</div>
    <div style={{fontSize:7,color:"#e9c46a",marginBottom:8}}>Skill Points: {gs.skillPoints||0}</div>
    {tree.map((skill,i)=>{
      const owned=(gs.skills||[]).includes(skill.id);
      const canLearn=gs.level>=skill.level&&(gs.skillPoints||0)>=skill.cost&&!owned;
      const locked=gs.level<skill.level;
      return <div key={skill.id} style={{marginBottom:4,padding:"5px 6px",border:`1px solid ${owned?"#2a9d8f33":canLearn?"#e9c46a33":"#161616"}`,background:owned?"#2a9d8f08":canLearn?"#e9c46a05":"#090909",opacity:locked?0.4:1}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
          <span style={{color:owned?"#2a9d8f":canLearn?"#e9c46a":"#555",fontSize:8}}>{owned?"✓ ":""}{skill.name}</span>
          <span style={{fontSize:7,color:owned?"#2a9d8f":locked?"#333":"#666"}}>{owned?"learned":locked?`Lvl ${skill.level}`:`${skill.cost}pt`}</span>
        </div>
        <div style={{color:"#888",fontSize:7,lineHeight:1.4,marginBottom:canLearn?4:0}}>{skill.desc}</div>
        {canLearn&&<div onClick={()=>onUnlock(skill)} style={{fontSize:7,color:"#e9c46a",cursor:"pointer",padding:"2px 0"}}>→ UNLOCK ({skill.cost}pt)</div>}
      </div>;
    })}
  </div>;
}

// ── Equipment Panel Component ─────────────────────────────────────────────────
function GearPanel({gs,onUnequip,day,boro}){
  const eqStats=getItemStats(gs.equipment);
  const prices={common:50,uncommon:150,rare:400,legendary:1200};
  const seed=(day+boro.length)%BASE_ITEMS.length;
  const market=[BASE_ITEMS[seed%BASE_ITEMS.length],BASE_ITEMS[(seed+7)%BASE_ITEMS.length],BASE_ITEMS[(seed+13)%BASE_ITEMS.length]];
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// EQUIPPED</div>
    {EQUIPMENT_SLOTS.map(slot=>{
      const itemId=gs.equipment?.[slot];const item=itemId?getItemById(itemId):null;
      const rar=item?ITEM_RARITY[item.rarity]:null;
      return <div key={slot} style={{display:"flex",justifyContent:"space-between",marginBottom:3,padding:"3px 5px",border:`1px solid ${item?"#252525":"#111"}`,background:item?"#0e0e0e":"#080808"}}>
        <div>
          <div style={{fontSize:7,color:"#777",letterSpacing:1}}>{slot.toUpperCase()}</div>
          {item&&<div style={{color:rar?.color||"#888",fontSize:8}}>{rar?.prefix}{item.name}</div>}
          {item&&<div style={{color:"#999",fontSize:7}}>{Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(" ")}</div>}
          {!item&&<div style={{color:"#888",fontSize:7}}>empty</div>}
        </div>
        {item&&<div onClick={()=>onUnequip(slot)} style={{fontSize:7,color:"#e63946",cursor:"pointer",alignSelf:"center"}}>✕</div>}
      </div>;
    })}
    {Object.keys(eqStats).length>0&&<div style={{fontSize:7,color:"#2a9d8f",marginTop:4,padding:"3px 5px",border:"1px solid #2a9d8f22",background:"#2a9d8f08"}}>
      Total: {Object.entries(eqStats).map(([k,v])=>`${k}+${v}`).join(" ")}
    </div>}
    <div style={{color:"#555",letterSpacing:2,margin:"8px 0 4px"}}>// BLACK MARKET</div>
    {market.map(item=>{
      const rar=ITEM_RARITY[item.rarity];const price=prices[item.rarity];
      const canAfford=gs.cash>=price;
      return <div key={item.id} style={{marginBottom:3,padding:"4px 5px",border:`1px solid ${rar.color}22`,background:`${rar.color}05`}}>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{color:rar.color,fontSize:8}}>{rar.prefix}{item.name}</span>
          <span style={{color:canAfford?"#e9c46a":"#444",fontSize:7}}>${price}</span>
        </div>
        <div style={{color:"#333",fontSize:7}}>{item.slot} · {Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(", ")}</div>
      </div>;
    })}
    {/* Full equippable catalog by slot */}
    <div style={{color:"#555",letterSpacing:2,marginTop:8,marginBottom:4}}>// IN INVENTORY</div>
    {(gs?.inventory||[]).filter(itemName=>{
      const item=BASE_ITEMS.find(b=>b.name===itemName||b.id===itemName);
      return !!item;
    }).map((itemName,i)=>{
      const item=BASE_ITEMS.find(b=>b.name===itemName||b.id===itemName);
      const rar=ITEM_RARITY[item.rarity];
      const isEquipped=Object.values(gs?.equipment||{}).includes(item.id);
      return <div key={i} style={{marginBottom:3,padding:"3px 5px",border:`1px solid ${isEquipped?rar.color+"44":"#161616"}`,background:isEquipped?`${rar.color}08`:"transparent",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{color:rar.color,fontSize:7}}>{rar.prefix||RARITY_SYMBOL[item.rarity]} {item.name}</div>
          <div style={{color:"#666",fontSize:6}}>{item.slot} · {Object.entries(item.stats||{}).filter(([,v])=>typeof v==="number").map(([k,v])=>`${k}+${v}`).join(" ")}</div>
        </div>
        {!isEquipped&&<div onClick={()=>onEquip&&onEquip(item.slot)} style={{fontSize:6,color:"#2a9d8f",cursor:"pointer",padding:"1px 4px",border:"1px solid #2a9d8f33"}}>EQUIP</div>}
        {isEquipped&&<div style={{fontSize:6,color:rar.color}}>ON</div>}
      </div>;
    })}
    <div style={{color:"#999",fontSize:7,marginTop:6,borderTop:"1px solid #111",paddingTop:4}}>GEAR · EQUIP [name] · UNEQUIP [slot] · LOOT · BUY ITEM [name]</div>
  </div>;
}

export default function NYC(){
  const [phase,setPhase]   =useState("boot");
  const [gameTime,setGameTime] =useState({hour:8,minute:0}); // game starts at 8am
  const [newspaper,setNewspaper]=useState(null); // today's street report
  const [rareEvent,setRareEvent]   =useState(null);
  const [combat,setCombat]         =useState(null); // active combat state
  const [tutStep,setTutStep]       =useState(0);    // tutorial step index
  const [tutDone,setTutDone]       =useState(false);
  const [abilityCooldowns,setAbilityCooldowns] =useState({});
  const [prestige,setPrestige]   =useState(0);    // prestige level
  const [bootL,setBootL]   =useState([]);
  const [selA,setSelA]     =useState(null);
  const [nameIn,setNameIn] =useState("");
  const [pinIn,setPinIn]   =useState("");
  const [cName,setCName]   =useState("");
  const [cPin,setCPin]     =useState("");
  const [savedChar,setSavedChar] =useState(null);
  const [backstory,setBackstory] =useState({});
  const [bsStep,setBsStep]       =useState(0);
  const [bsDone,setBsDone]       =useState(false); // loaded save data
  const [gs,setGs]         =useState(null);
  const [world,setWorld]   =useState(defWorld());
  const [cmd,setCmd]       =useState("");
  const [feed,setFeed]     =useState([]);
  const [boro,setBoro]     =useState("manhattan");
  const [tab,setTab]       =useState("map");
  const [mProd,setMProd]   =useState("weed");
  const [mQty,setMQty]     =useState(1);
  const [npcs,setNpcs]     =useState(NPCS);
  const [pulse,setPulse]   =useState(false);
  const [wMsgs,setWMsgs]   =useState([]);
  const [mIn,setMIn]       =useState("");
  const gsRef=useRef(null);const feedRef=useRef(null);const inputRef=useRef(null);
  const chatRef=useRef(null);
  const worldRef=useRef(null);
  const boroRef=useRef(null);
  const lastActivityRef=useRef(Date.now());
  const [unread,setUnread]=useState(0);
  useEffect(()=>{gsRef.current=gs;},[gs]);
  useEffect(()=>{if(feedRef.current)feedRef.current.scrollTop=feedRef.current.scrollHeight;},[feed]);

  // boot
  useEffect(()=>{
    if(phase!=="boot")return;
    let i=0;const iv=setInterval(()=>{
      if(i<BOOT.length){setBootL(p=>[...p,BOOT[i]]);i++;}
      else{clearInterval(iv);setTimeout(()=>setPhase("character"),500);}
    },210);
    return()=>clearInterval(iv);
  },[phase]);

  // load world
  useEffect(()=>{(async()=>{try{const w=await loadWorld();if(w)setWorld(w);}catch(e){console.error(e)}})();},[]);

  const saveWorld=async(w)=>{try{await sbSaveWorld(w);}catch(e){console.error("saveWorld error",e)}};

  const generateNewspaper=(gs,world)=>{
    const day=gs.day;
    const weather=getWeather(day);
    const players=Object.entries(world.players||{});
    const pvpLog=world.pvpLog||[];
    const history=world.worldHistory||[];
    const corners=world.corners||{};
    const legends=world.wallOfDead||[];

    // Headlines — pick the most interesting things that happened
    const headlines=[];

    // Top earner from world history
    const dealEvents=history.filter(h=>h.type==="deal"||h.type==="quest");
    if(dealEvents.length>0){
      const last=dealEvents[dealEvents.length-1];
      headlines.push(`${last.actor} making moves in ${getBoro(last.boro)?.name}.`);
    }

    // PvP activity
    const recentPvp=pvpLog.slice(-3);
    if(recentPvp.length>0){
      const pvp=recentPvp[recentPvp.length-1];
      headlines.push(`${pvp.attacker} and ${pvp.victim} had words in ${getBoro(pvp.boro)?.name}. Only one walked away clean.`);
    }

    // Corner control
    const cornerOwners=Object.entries(corners);
    if(cornerOwners.length>0){
      const [bId,owner]=cornerOwners[Math.floor(Math.random()*cornerOwners.length)];
      headlines.push(`${getBoro(bId)?.name} corner still belongs to ${owner}. For now.`);
    }

    // Captain
    if(world.captainBoro&&world.captainDay===day){
      headlines.push(`THE CAPTAIN spotted in ${getBoro(world.captainBoro)?.name}. Stay off the corners.`);
    }

    // Weather note
    const weatherNotes={
      blizzard:"Half the city called out today. Streets belong to whoever's desperate enough to be out there.",
      rain:"Rain keeps the civilians inside. The corners are yours if you want them.",
      heatwave:"City's on edge. Heat brings out the worst in everyone. Cops included.",
      storm:"Lightning hit a transformer on 3rd Ave. Three blocks dark. Opportunity.",
      fog:"You can't see past the corner tonight. Neither can anyone else.",
      clear:"Clean day. No excuses.",
      cloudy:"Gray. Quiet. The kind of day where things happen without witnesses.",
    };
    headlines.push(weatherNotes[weather.id]||"Another day out here.");

    // Dead
    if(legends.length>0){
      const recent=legends[legends.length-1];
      headlines.push(`${recent.name} went down on Day ${recent.day}. ${recent.msg||"Gone."}`);
    }

    // Player count
    if(players.length>1){
      headlines.push(`${players.length} people running these streets right now. You know some of them.`);
    }

    // Personal note
    const personalNotes=[
      `You've survived ${day} days. The city expected less of you.`,
      `Day ${day}. You're still here. That's not nothing.`,
      `${day} days on the street. You know things now that you didn't before.`,
      `Day ${day}. The city doesn't care. You do. That's the difference.`,
    ];

    return {
      day, weather,
      headlines: headlines.slice(0,4),
      personal: personalNotes[Math.floor(Math.random()*personalNotes.length)],
      date: new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}),
    };
  };

  const addWorldHistory=(ws,type,actor,detail,bId)=>{
    const entry={type,actor,detail,boro:bId,time:Date.now(),day:ws.players?.[actor]?.day||1};
    return{...ws,worldHistory:[...(ws.worldHistory||[]).slice(-49),entry]};
  };

  // Broadcast to activity feed — all players see this
  const broadcastActivity=(ws,msg,icon="🌆")=>{
    const entry={msg,icon,time:Date.now(),id:Math.random().toString(36).slice(2)};
    return{...ws,notifications:[...(ws.notifications||[]).slice(-29),entry]};
  };

  const notifyPlayers=(ws,excludeName,msg)=>{
    // add to world chat as a system message
    const entry={from:"SYSTEM",text:msg,time:Date.now(),boro:"system",system:true};
    return{...ws,messages:[...(ws.messages||[]).slice(-19),entry]};
  };
  const saveChar=async(g,pin)=>{try{await saveCharacter(g,pin);}catch(e){console.error("saveChar",e)}};
  const loadChar=async(name,pin)=>loadCharacter(name,pin);

  const addJournalEntry=(g,entry)=>{
    const journal=[...(g.journal||[]),entry].slice(-50); // keep last 50 entries
    return{...g,journal};
  };

  const journalEvent=(eventKey,...args)=>{
    if(!gsRef.current)return;
    const entry=JOURNAL_EVENTS[eventKey]?.(gsRef.current,...args);
    if(entry)updGs(g=>addJournalEntry(g,entry));
  };

  // ── REAL-TIME WORLD SYNC ──────────────────────────────────────────────────
  const handleWorldUpdate=(fresh)=>{
    if(!fresh)return;
    worldRef.current=fresh;
    const prevMsgCount=(wMsgs||[]).length;
    // normalize: Supabase returns snake_case, game uses camelCase
    // messages column is just "messages" in both - should work
    // but player_alerts vs playerAlerts needs merging
    const normalized={
      ...fresh,
      messages: fresh.messages||[],
      pvpLog: fresh.pvp_log||fresh.pvpLog||[],
      playerAlerts: fresh.player_alerts||fresh.playerAlerts||{},
      wallOfDead: fresh.wall_of_dead||fresh.wallOfDead||[],
      worldHistory: fresh.world_history||fresh.worldHistory||[],
      captainBoro: fresh.captain_boro||fresh.captainBoro||null,
      captainDay: fresh.captain_day||fresh.captainDay||0,
      shelterCheckins: fresh.shelter_checkins||fresh.shelterCheckins||{},
      copPresence: fresh.cop_presence||fresh.copPresence||{},
    };
    const newMsgs=normalized.messages;
    setWorld(normalized);
    setWMsgs(newMsgs);
    // auto scroll chat if open
    setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},50);
    // count unread from others
    if(newMsgs.length>prevMsgCount&&tab!=="chat"){
      const newOnes=newMsgs.slice(prevMsgCount);
      const fromOthers=newOnes.filter(m=>m.from!==gsRef.current?.name);
      if(fromOthers.length>0)setUnread(u=>u+fromOthers.length);
    }
    setPulse(true);setTimeout(()=>setPulse(false),800);
    const g=gsRef.current;if(!g)return;
    // player alerts — attacks, bounties, wires, dominates etc
    const alerts=(normalized.playerAlerts||{})[g.name]||[];
    if(alerts.length>0){
      alerts.forEach(a=>{
        const msg=typeof a==="string"?a:a.msg;
        if(msg)setFeed(p=>[...p,``,`📨 ${msg}`,``]);
      });
      // clear alerts after reading
      const ws={...fresh,
        playerAlerts:{...(fresh.playerAlerts||{}), [g.name]:[]},
        player_alerts:{...(fresh.player_alerts||{}),[g.name]:[]},
      };
      setWorld(ws);saveWorld(ws);
    }
    // corner stolen alert
    (g.cornersOwned||[]).forEach(bId=>{
      if(normalized.corners?.[bId]&&normalized.corners[bId]!==g.name)
        setFeed(p=>[...p,`⚠ ${fresh.corners[bId]} took your ${getBoro(bId)?.name} corner while you were away.`]);
    });
  };

  // Real-time subscription (instant updates)
  useEffect(()=>{
    let channel;
    try{
      channel=subscribeToWorld((fresh)=>handleWorldUpdate(fresh));
    }catch(e){console.error("Realtime sub error",e);}
    // Heartbeat — update our lastSeen every 30s so others know we're online
    const heartbeat=setInterval(()=>{
      const g=gsRef.current;if(!g)return;
      const freshWorld=worldRef?.current;if(!freshWorld)return;
      const ws={...freshWorld,players:{...(freshWorld.players||{}),[g.name]:{
        level:g.level,borough:boroRef?.current||"manhattan",
        lastSeen:Date.now(),heat:Math.round(g.heat),
        archId:g.archetype?.id||"veteran",name:g.name
      }}};
      saveWorld(ws);
    },30000);
    // Fallback poll every 8 seconds (covers any missed real-time events)
    const iv=setInterval(async()=>{
      try{
        const w2=await loadWorld();
        if(w2)handleWorldUpdate(w2);
      }catch{}
    },8000);
    return()=>{
      clearInterval(iv);
      if(channel)try{unsubscribe(channel);}catch{}
    };
  },[]);

  // Game clock — 1 real minute = 1 game minute (slow, atmospheric)
  useEffect(()=>{
    const clockTick=setInterval(()=>{
      setGameTime(prev=>{
        let {hour,minute}=prev;
        minute+=1;
        if(minute>=60){minute=0;hour++;}
        if(hour>=26){return{hour:8,minute:0};}
        return{hour,minute};
      });
    },60000); // every real minute = 1 game minute
    return()=>clearInterval(clockTick);
  },[]);

  // survival tick 60s — weather affects drain rates
  useEffect(()=>{
    if(phase!=="game")return;
    const iv=setInterval(()=>{
      setGs(p=>{
        if(!p)return p;
        const w=getWeather(p.day);
        const inSafehouse=!!(world.safehouses?.[boro]&&(world.safehouses[boro].owner===p.name||(p.crew&&world.safehouses[boro].crewOwner===p.crew)));
        const warmDrain=inSafehouse?0.5:w.warmthDrain;  // safehouse protects from cold
        const safeHeatDrain=inSafehouse?(world.safehouses[boro].level||1)*0.5:0;
        const mentalDrain=p.survival.hunger<20?2:p.survival.health<30?2:p.survival.warmth<20?1:0;
        const mentalBoost=p.crew?0.5:0; // crew contact helps
        const g={...p,survival:{
          hunger:clamp(p.survival.hunger-4,0,100),
          warmth:clamp(p.survival.warmth-warmDrain,0,100),
          health:p.survival.hunger<15?clamp(p.survival.health-5,0,100):p.survival.health,
          energy:clamp(p.survival.energy-2,0,100),
          mental:clamp((p.survival.mental||70)-mentalDrain+mentalBoost+dogMentalBoost,0,100),
        },heat:clamp(p.heat-0.1-safeHeatDrain,0,10)};
        if(g.survival.warmth===0)g.survival.health=clamp(g.survival.health-3,0,100);
        if(g.isUndoc){
          // undocumented: high heat = ghost mode (disappear), not wanted
          if(Math.round(g.heat)>=9&&!g.ghostMode){
            g.ghostMode=true;
            setTimeout(()=>setFeed(f=>[...f,``,`👻 GHOST MODE. Heat critical. You vanished into the community. Lay low.`,``]),10);
          } else if(g.heat<5&&g.ghostMode){
            g.ghostMode=false;
            setTimeout(()=>setFeed(f=>[...f,`Heat cooled. Back on the street.`]),10);
          }
        } else {
          if(Math.round(g.heat)>=10&&!g.wanted){
            g.wanted=true;
            setTimeout(()=>{setFeed(f=>[...f,``,`🚨 WANTED. Cops hunting you. Lay low.`,``]);journalEvent('wanted');},10);
          } else if(g.heat<7&&g.wanted){
            g.wanted=false;
            setTimeout(()=>setFeed(f=>[...f,`Heat cooled. Off the wanted list.`]),10);
          }
        }
        if(!g.isVampire&&g.survival.hunger<20)setTimeout(()=>setFeed(f=>[...f,`Starving. EAT now.`]),10);
        // ── ADDICTION ENGINE ─────────────────────────────────────────────────
        if(!g.isVampire&&!g.isUndoc){
          const sub=CLASS_SUBSTANCE[g.archetype?.id||"veteran"];
          const addiction=g.addiction||0;
          const daysSinceUse=g.day-(g.lastUsed||0);
          const withdrawThresh=Math.max(1,3-Math.floor(addiction/30));
          if(daysSinceUse>withdrawThresh&&addiction>20){
            const wEvts=WITHDRAWAL_EVENTS[sub?.name]||WITHDRAWAL_EVENTS.stress;
            const wEvt=wEvts[Math.floor(Math.random()*wEvts.length)];
            const severity=Math.floor(addiction/20);
            setTimeout(()=>setFeed(f=>[...f,"",`🤢 WITHDRAWAL (${getAddictionLevel(addiction).name}):`,wEvt,""]),10);
            setGs(prev=>{
              if(!prev)return prev;
              return{...prev,survival:{...prev.survival,
                health:clamp(prev.survival.health-(severity*4),0,100),
                mental:clamp((prev.survival.mental||70)-(severity*6),0,100),
                energy:clamp(prev.survival.energy-(severity*8),0,100),
              },heat:addiction>80?clamp(prev.heat+1,0,10):prev.heat,
              withdrawalDay:(prev.withdrawalDay||0)+1};
            });
          }
          const hasSub=sub?.product&&(g.product[sub.product]||0)>0;
          const useChance=(addiction/100)*0.15;
          if(hasSub&&Math.random()<useChance&&addiction>30){
            const hEvts=HIGH_EVENTS[sub.name]||HIGH_EVENTS.weed;
            const hEvt=hEvts[Math.floor(Math.random()*hEvts.length)];
            setTimeout(()=>setFeed(f=>[...f,"",`${sub.icon} You dip into your own stash.`,hEvt.msg,""]),10);
            setGs(prev=>{
              if(!prev)return prev;
              const eff=hEvt.effect||{};
              let np={...prev,lastUsed:prev.day,withdrawalDay:0,highActive:true,addiction:Math.min(100,prev.addiction+rnd(2,5))};
              if(eff.cash)np={...np,cash:Math.max(0,np.cash+eff.cash)};
              if(eff.health)np={...np,survival:{...np.survival,health:clamp(np.survival.health+eff.health,0,100)}};
              if(eff.mental)np={...np,survival:{...np.survival,mental:clamp((np.survival.mental||70)+eff.mental,0,100)}};
              if(eff.energy)np={...np,survival:{...np.survival,energy:clamp(np.survival.energy+(eff.energy||0),0,100)}};
              if(eff.heat)np={...np,heat:clamp(np.heat+eff.heat,0,10)};
              if(sub.product)np={...np,product:{...np.product,[sub.product]:Math.max(0,np.product[sub.product]-1)}};
              return np;
            });
          }
          if(hasSub&&Math.random()<0.05)setGs(prev=>prev?{...prev,addiction:Math.min(100,prev.addiction+1)}:prev);
          if(addiction>=95&&!hasSub&&daysSinceUse>1){
            setTimeout(()=>setFeed(f=>[...f,"","☠ Rock bottom.",getAddictionLevel(addiction).desc,"You'd do anything right now. That's the most dangerous place to be.",""]),10);
            setGs(prev=>prev?{...prev,survival:{...prev.survival,health:clamp(prev.survival.health-10,0,100),mental:clamp((prev.survival.mental||70)-15,0,100)},heat:clamp(prev.heat+2,0,10)}:prev);
          }
        }

        // cop patrol trigger — based on heat + borough cop presence
        const bCopPresence=getCopPresence(boro,world.copPresence,g.day);
        const patrolChance=(g.heat/10)*(bCopPresence/10)*0.3;
        if(Math.random()<patrolChance&&!g.patrolEncountered){
          const evt=PATROL_EVENTS[rnd(0,PATROL_EVENTS.length-1)];
          setTimeout(()=>setFeed(f=>[...f,``,`🚔 ${evt}`,`HIDE · RUN · BRIBE · TALK to respond.`,``]),10);
          setGs(prev=>prev?{...prev,patrolEncountered:true}:prev);
        } else if(g.patrolEncountered){
          setGs(prev=>prev?{...prev,patrolEncountered:false}:prev);
        }
        // cash over limit — robbery target
        if(g.cash>MAX_CARRY_CASH&&Math.random()<0.05){
          setTimeout(()=>setFeed(f=>[...f,`⚠ Carrying $${g.cash}. You're a target. Stash it or wire it.`]),10);
        }
        // product weight penalty
        const weight=getCarryWeight(g.product);
        if(weight>MAX_CARRY_WEIGHT){
          setTimeout(()=>setFeed(f=>[...f,`Heavy load (${weight.toFixed(1)}/${MAX_CARRY_WEIGHT}). Moving slower, more visible.`]),10);
        }
        // vampire sunlight damage — warmth drains faster during day (every other tick = day)
        if(g.isVampire){
          const isDaytime=(Date.now()%(1000*60*2))<(1000*60); // rough day cycle
          if(isDaytime&&g.survival.warmth>0){
            g.survival={...g.survival,warmth:clamp(g.survival.warmth-4,0,100)};
            if(g.survival.warmth<20)setTimeout(()=>setFeed(f=>[...f,`☀️ Sunlight burning. Find darkness.`]),10);
          }
          // thrall income
          if(g.thralls?.length>0){
            const income=g.thralls.length*30;
            setTimeout(()=>setFeed(f=>[...f,`🧛 Thrall income: +$${income}.`]),10);
          }
        }
        const mental=g.survival.mental||70;
        const mStage=getMentalStage(mental);
        // Mental health consequences by stage
        if(g.isSchizo&&mental<20){setTimeout(()=>setFeed(f=>[...f,"🌀 THE VOICES ARE LOUDEST NOW. Everything is clearer."]),10);}
        if(mental<60&&Math.random()<0.15&&!g.isSchizo){
          let consequences=[];
          if(mental<20)consequences=MENTAL_CONSEQUENCES.shattered;
          else if(mental<40)consequences=MENTAL_CONSEQUENCES.breaking;
          else if(mental<60)consequences=MENTAL_CONSEQUENCES.fragile;
          else consequences=MENTAL_CONSEQUENCES.strained;
          const evt=consequences[rnd(0,consequences.length-1)];
          setTimeout(()=>setFeed(f=>[...f,``,`${mStage.icon} ${evt}`,``]),10);
          // At breaking/shattered, automatic bad decisions
          if(mental<40&&Math.random()<0.3){
            const badDecision=rnd(0,2);
            if(badDecision===0&&g.cash>20){
              setTimeout(()=>setFeed(f=>[...f,`You spent $20 without thinking about it. It's gone.`]),50);
              return{...g,cash:Math.max(0,g.cash-20)};
            } else if(badDecision===1&&g.heat<10){
              setTimeout(()=>setFeed(f=>[...f,`You made a scene. Heat +1.`]),50);
              return{...g,heat:clamp(g.heat+1,0,10)};
            }
          }
        }
        if(g.survival.warmth<15&&w.id==="blizzard")setTimeout(()=>setFeed(f=>[...f,`❄️ Blizzard. Find shelter or you'll freeze.`]),10);
        if(g.survival.health<=0){
          setTimeout(()=>{
            const dWs=broadcastActivity(world,`☠ ${g.name} went down on Day ${g.day}. Level ${g.level}.`,"☠");setWorld(dWs);saveWorld(dWs);
            setFeed(f=>[...f,``,`☠ YOU DIED. Day ${g.day}. Level ${g.level}.`,`Legacy: $${Math.floor(g.cash*0.2)} carries forward.`,`Refresh to start again.`]);
            setWorld(prev=>{const ws={...prev,wallOfDead:[...(prev.wallOfDead||[]).slice(-19),{name:g.name,level:g.level,day:g.day,time:Date.now()}]};saveWorld(ws);return ws;});
          },10);
        }
        return g;
      });
    },60000);
    return()=>clearInterval(iv);
  },[phase,boro]);

  const push=(...lines)=>setFeed(p=>[...p,...lines]);
  const updGs=fn=>setGs(p=>{
    if(!p)return p;
    const next=fn({...p});
    // auto-save character every update if pin exists
    if(cPin)saveChar(next,cPin);
    return next;
  });
  const applyXP=(g,amt,type)=>{
    const bonus=g.archetype?.xp?.[type]||0;const newXP=g.xp+amt+bonus;
    const nLvl=getLvl(newXP);
    let newStats={...g.stats};
    if(nLvl>g.level){
      // auto stat growth based on archetype
      const archId=g.archetype?.id||"veteran";
      const growthTable=LEVEL_STAT_GROWTH[archId]||LEVEL_STAT_GROWTH.veteran;
      const statToGrow=growthTable[(nLvl-2)%growthTable.length];
      newStats={...newStats,[statToGrow]:Math.min((newStats[statToGrow]||0)+1,10)};
      const lvlUpMsgs=[
        `Something shifted. You can feel it.`,
        `You've been out here long enough that the street is starting to make sense.`,
        `Another level. Another version of yourself that knows more and trusts less.`,
        `Experience is just pain you survived long enough to learn from.`,
      ];
      setTimeout(()=>{
        push(``,`★━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━★`,
          `  LEVEL ${nLvl}`,
          `  ${lvlUpMsgs[Math.floor(Math.random()*lvlUpMsgs.length)]}`,
          `  + ${statToGrow.toUpperCase()} → ${newStats[statToGrow]}`,
          `  + 1 Skill Point available (SKILLS)`,
          `★━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━★`,``);
        journalEvent('levelUp',nLvl);
        const lvlWs=broadcastActivity(world,`${gs.name} hit Level ${nLvl}. Still standing.`,"⭐");
        setWorld(lvlWs);saveWorld(lvlWs);
      },10);
    }
    const newSkillPoints=(g.skillPoints||0)+(nLvl>g.level?1:0);
    const retireEligible=nLvl>=PRESTIGE_LEVEL;
    if(retireEligible&&!g.retireEligible){
      setTimeout(()=>push(``,`🏆 You've reached Level ${PRESTIGE_LEVEL}. Type RETIRE to prestige and leave your mark.`,``),50);
    }
    return{...g,xp:newXP,level:nLvl,stats:newStats,retireEligible,skillPoints:newSkillPoints};
  };

  const continueGame=(saved)=>{
    setGs(saved);
    const weather=getWeather(saved.day);
    push(`— WELCOME BACK, ${saved.name} —`,`Day ${saved.day}. Level ${saved.level}. $${saved.cash}.`,`${weather.icon} Today: ${weather.name} — ${weather.desc}`,``,`Type HELP for commands.`);
    setPhase("game");
  };

  const startGame=()=>{
    if(!selA||!cName)return;
    const arch=ARCHETYPES.find(a=>a.id===selA);
    const weather=getWeather(1);
    const startCash = (arch.startCash || 40) + (prestige * 10) +
      (BACKSTORY_QUESTIONS[0].options.find(o=>o.id===backstory.why)?.startBonus?.cash||0);
    const prestigeBuff = prestige>0 ? PRESTIGE_BUFFS[(prestige-1)%PRESTIGE_BUFFS.length] : null;
    const leftOpt=BACKSTORY_QUESTIONS[1].options.find(o=>o.id===backstory.left);
    const driveOpt=BACKSTORY_QUESTIONS[2].options.find(o=>o.id===backstory.drive);
    const startMental=clamp(70+(leftOpt?.mentalMod||0)+(driveOpt?.mentalBonus||0),20,90);
    const whyOpt=BACKSTORY_QUESTIONS[0].options.find(o=>o.id===backstory.why);
    const startHeat=Math.max(0,(arch.stats.heat||3)+(whyOpt?.statMod?.heat||0));
    const state={name:cName,archetype:arch,level:1,xp:0,cash:startCash,
      stats:(()=>{
        let s={...arch.stats};
        if(prestigeBuff)s={...s,[prestigeBuff.stat]:Math.min(10,(s[prestigeBuff.stat]||0)+prestigeBuff.amt)};
        // apply backstory stat mods
        const whyOpt=BACKSTORY_QUESTIONS[0].options.find(o=>o.id===backstory.why);
        if(whyOpt?.statMod)Object.entries(whyOpt.statMod).forEach(([k,v])=>{if(k!=="heat")s={...s,[k]:Math.min(10,(s[k]||0)+v)};});
        return s;
      })(),
      survival:{hunger:75,warmth:60,health:85,energy:90,
        mental: arch.id==="junkie"?Math.min(startMental,45):arch.id==="undocumented"?Math.min(startMental,65):startMental},
      inventory:[...arch.gear],product:{weed:0,pills:0,powder:0},cooked:{},
      rep:{bronx:0,brooklyn:0,manhattan:5,queens:0,staten:0},
      heat:startHeat,day:1,cornersOwned:[],crew:null,crewRole:null,
      wanted:false,ghostMode:false,habitPaid:false,
      shelterCheckins:{},lastSearch:0,letterWritten:false,prestige:prestige||0,retireEligible:false,
      skills:[],skillPoints:1,
      backstory:backstory||{},journal:[],
      xpMult:driveOpt?.xpMult||1.0,
      activeQuests:{},completedQuests:[],questProgress:{},
      title:"",
      wantedStars:0,patrolEncountered:false,
      cashStash:0,  // cash stored safely (safe house or crew bank)
      debtOwed:0,   // fronted product debt
      dayJobDone:false, hasMetrocard:false,
      addiction:0, lastUsed:-1, withdrawalDay:0, highActive:false,
      hustleCount:0,       // times hustled today
      hustleBoroLast:"",   // last borough hustled in
      hustleBoros:{},      // per-borough hustle count today
      equipment:{head:null,chest:null,hands:null,feet:null,weapon:null,accessory:null},
      // archetype flags
      isJunkie:arch.id==="junkie",
      isUndoc:arch.id==="undocumented",
      isHustler:arch.id==="hustler",
      isVampire:arch.id==="vampire",
      isSchizo:arch.id==="schizo",
      isDrifter:arch.id==="drifter",
      dogName:arch.id==="drifter"?["Biscuit","Smoke","Patches","Duke","Gus","Lucky","Shadow","Boo"][rnd(0,7)]:null,
      isFixer:arch.id==="fixer",
      isRat:arch.id==="rat",
      thralls:[],feedCount:0,feedUsed:false,
      informsToday:0,exposedAsRat:false,ratHandles:[],networkEarnings:0,
      wiresSent:0,brokeredDeals:0,
    };
    setGs(state);
    const ws={...world,players:{...(world.players||{}),[cName]:{level:1,borough:"manhattan",lastSeen:Date.now(),heat:arch.stats.heat}}};
    setWorld(ws);saveWorld(ws);
    const specialMsg = arch.id==="junkie"
      ? `Your habit costs $20/day. Feed it or your health pays the price.`
      : arch.id==="undocumented"
      ? `No shelters. No hospitals. No record. Stay invisible. GHOST MODE replaces WANTED.`
      : arch.id==="hustler"
      ? `You started with $${startCash}. Markets are your battlefield. Don't get caught in a fight.`
      : arch.id==="vampire"
      ? `You don't need food. You need blood. FEED on NPCs for health and cash. Sunlight drains warmth fast. Night is your economy.`
      : arch.id==="fixer"
      ? `You know everyone. BROKER deals between players for 10%. WIRE cash. REPAIR gear. You never fight — you negotiate.`
      : arch.id==="rat"
      ? `You work both sides. INFORM on players to your Handler for cash. Get exposed and everyone hunts you. Trust nobody.`
      : ``;
    const whyFlavor=BACKSTORY_QUESTIONS[0].options.find(o=>o.id===backstory.why)?.flavor||"";
    const leftFlavor=BACKSTORY_QUESTIONS[1].options.find(o=>o.id===backstory.left)?.flavor||"";
    const driveFlavor=BACKSTORY_QUESTIONS[2].options.find(o=>o.id===backstory.drive)?.flavor||"";
    push(
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `DAY 1`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `You are ${cName}.`,
      `${arch.name}.`,
      ``,
      whyFlavor,
      leftFlavor,
      driveFlavor,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `34th Street and 8th Avenue. The city hums around you with complete indifference.`,
      `Cold wind off the Hudson. $${state.cash} to your name.`,
      `You've slept in worse places. You'll sleep in worse again.`,
      ``,
      `${weather.icon} ${weather.name} — ${weather.desc}`,
      specialMsg?``:  ``,
      specialMsg||``,
      ``,
      `Type HELP to see what you can do. Or just survive.`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    );
    // first journal entry
    setTimeout(()=>updGs(g=>addJournalEntry(g,`Day 1: ${whyFlavor} Starting over.`)),200);
    // start tutorial for new characters
    setTimeout(()=>push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,`📖 TUTORIAL — ${TUTORIAL_STEPS[0].msg}`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`),300);
    setTutStep(0);setTutDone(false);
    saveChar(state,pinIn);
    setPhase("game");
  };

  // ── Safe house helpers ────────────────────────────────────────────────────
  const buyOrUpgradeSafe=(upgrade=false)=>{
    if(!gs)return;
    const cost=upgrade?SAFEHOUSE_UPGRADE_COST:SAFEHOUSE_COST;
    if(gs.cash<cost){push(`Need $${cost}. Have $${gs.cash}.`);return;}
    const existing=world.safehouses?.[boro];
    if(!upgrade&&existing){push(`Already a safe house in ${getBoro(boro)?.name}.`);return;}
    if(upgrade&&(!existing||(existing.owner!==gs.name&&existing.crewOwner!==gs.crew))){push(`You don't own the safe house here.`);return;}
    if(upgrade&&(existing.level||1)>=3){push(`Already at max level.`);return;}
    const safe=upgrade?{...existing,level:(existing.level||1)+1}:{owner:gs.name,ownerLower:gs.name.toLowerCase(),crewOwner:gs.crew||null,level:1,stash:{weed:0,pills:0,powder:0},cashStash:0};
    const ws={...world,safehouses:{...world.safehouses,[boro]:safe}};
    setWorld(ws);saveWorld(ws);
    updGs(g=>({...g,cash:g.cash-cost}));
    push(upgrade?`Safe house upgraded to Level ${safe.level}. Heat drain +0.5/tick.`:`Safe house secured in ${getBoro(boro)?.name}.`,`You've got a stash spot. Heat drains faster here. Use REST SAFE to recover.`);if(!upgrade)journalEvent('firstSafe',boro);
  };
  const stashProduct=(pKey)=>{
    if(!gs)return;
    const safe=world.safehouses?.[boro];
    const ownsIt=safe&&(safe.owner===gs.name||safe.ownerLower===gs.name.toLowerCase()||safe.crewOwner===gs.crew);
    if(!ownsIt){push(`No safe house you own here.`);return;}
    const qty=gs.product[pKey]||0;if(qty===0){push(`No ${pKey} to stash.`);return;}
    const ws={...world,safehouses:{...world.safehouses,[boro]:{...safe,stash:{...safe.stash,[pKey]:(safe.stash?.[pKey]||0)+qty}}}};
    setWorld(ws);saveWorld(ws);
    updGs(g=>({...g,product:{...g.product,[pKey]:0}}));
    push(`Stashed all ${qty} ${PRODUCTS[pKey].name} in safe house.`,`Cops can't touch it there.`);
  };
  const unstashProduct=(pKey)=>{
    if(!gs)return;
    const safe=world.safehouses?.[boro];
    const ownsIt2=safe&&(safe.owner===gs.name||safe.ownerLower===gs.name?.toLowerCase()||safe.crewOwner===gs.crew);
    if(!ownsIt2){push(`No safe house you own here.`);return;}
    const qty=safe.stash?.[pKey]||0;if(qty===0){push(`Nothing stashed.`);return;}
    const ws={...world,safehouses:{...world.safehouses,[boro]:{...safe,stash:{...safe.stash,[pKey]:0}}}};
    setWorld(ws);saveWorld(ws);
    updGs(g=>({...g,product:{...g.product,[pKey]:g.product[pKey]+qty}}));
    push(`Retrieved ${qty} ${PRODUCTS[pKey].name} from safe house.`);
  };
  const restSafe=()=>{
    const safe=world.safehouses?.[boro];
    const ownsIt3=safe&&(safe.owner===gs?.name||safe.crewOwner===gs?.crew);
    if(!ownsIt3){push(`No safe house you own here.`);return;}
    updGs(g=>applyXP({...g,survival:{hunger:clamp(g.survival.hunger-5,0,100),warmth:100,health:clamp(g.survival.health+20,0,100),energy:100},heat:clamp(g.heat-2,0,10)},5,"rest"));
    push(`You crash at the safe house.`,`Fully warm. Health up. Heat drops 2.`,`Best sleep you've had in weeks.`);
  };

  // Tutorial progress checker
  const advanceTutorial=(triggeredCmd)=>{
    if(tutDone)return;
    const step=TUTORIAL_STEPS[tutStep];
    if(!step||!step.trigger)return;
    if(triggeredCmd.toUpperCase().startsWith(step.trigger)){
      const next=TUTORIAL_STEPS[tutStep+1];
      if(step.reward){
        updGs(g=>({...g,
          cash:g.cash+(step.reward.cash||0),
          skillPoints:(g.skillPoints||0)+(step.reward.skillPoints||0),
          xp:g.xp+(step.reward.xp||0),
        }));
      }
      if(next){
        setTutStep(tutStep+1);
        setTimeout(()=>push(``,`📖 ${next.msg}`,``),400);
        if(next.reward)setTimeout(()=>push(`  Tutorial bonus: ${Object.entries(next.reward).map(([k,v])=>`+${v} ${k}`).join(", ")}`),450);
      } else {
        setTutDone(true);
        const final=TUTORIAL_STEPS[TUTORIAL_STEPS.length-1];
        setTimeout(()=>{push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,final.msg,`  Bonus: +$20 · Type HELP anytime.`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);updGs(g=>({...g,cash:g.cash+20}));},400);
      }
    }
  };

  // D&D Combat resolver
  const resolveCombat=(gs,enemyType,onWin,onLose,onFlee)=>{
    const enemy={...ENEMIES[enemyType],...{hp:ENEMIES[enemyType].hp,maxHp:ENEMIES[enemyType].hp}};
    const cs=getCombatStats(gs);
    setCombat({enemy,cs,round:1,log:[`⚔ COMBAT — ${enemy.name}`,enemy.desc,``,`Your AC: ${cs.ac} · Attack: +${cs.attackBonus} · Lvl ${cs.level}`,`Enemy AC: ${enemy.ac} · HP: ${enemy.hp}`,``,`FIGHT · FLEE · USE [ability]`],
      onWin,onLose,onFlee,playerHp:cs.hp,advantage:false,halfDmg:false,skipEnemyTurn:false,stunEnemy:0,abilitiesUsed:{}});
  };

  const doCombatRound=(action,abilityId=null)=>{
    if(!combat)return;
    const gs2=gsRef.current;if(!gs2)return;
    let {enemy,cs,round,log,playerHp,advantage,halfDmg,skipEnemyTurn,stunEnemy,abilitiesUsed,onWin,onLose}=combat;
    const newLog=[...log,``,`— Round ${round} —`];
    let abilityResult=null;
    let newSkipEnemy=false;
    let newStunEnemy=Math.max(0,(stunEnemy||0)-1);
    let newAdvantage=false;
    let newHalfDmg=false;
    let endCombat=false;
    let cashCost=0;

    // ── PLAYER ACTION ──
    if(action==="flee"){
      const fleeRoll=roll(20);const fleeDC=10;
      if(fleeRoll+mod(gs2.stats?.hustle||5)>=fleeDC){
        newLog.push(`🏃 Flee roll: d20=${fleeRoll}+${mod(gs2.stats?.hustle||5)}=${fleeRoll+mod(gs2.stats?.hustle||5)} vs DC${fleeDC}. You're gone.`);
        setCombat(null);combat.onFlee&&combat.onFlee();push(...newLog);return;
      } else {
        newLog.push(`🏃 Flee roll: d20=${fleeRoll}. Failed. Enemy gets a free hit.`);
        const freeDmg=roll(enemy.damage[0]||6)+Math.max(0,enemy.attackBonus-2);
        playerHp=Math.max(1,playerHp-freeDmg);
        newLog.push(`  Enemy hits for ${freeDmg} while you run. HP: ${playerHp}`);
      }
    } else if(action==="ability"&&abilityId){
      const archAbilities=COMBAT_ABILITIES[gs2.archetype?.id]||[];
      const ability=archAbilities.find(a=>a.id===abilityId);
      if(ability){
        const cd=abilityCooldowns[abilityId]||0;
        if(cd>0){newLog.push(`${ability.name} on cooldown (${cd} rounds).`);}
        else {
          abilityResult=ability.fn(gs2,enemy);
          newLog.push(...(abilityResult.log||[]));
          if(abilityResult.enemyDmg>0){
            enemy={...enemy,hp:Math.max(0,enemy.hp-abilityResult.enemyDmg)};
            newLog.push(`  ${enemy.name} HP: ${enemy.hp}/${enemy.maxHp}`);
          }
          if(abilityResult.selfDmg>0){
            playerHp=Math.max(1,playerHp-abilityResult.selfDmg);
          } else if(abilityResult.selfDmg<0){
            // negative selfDmg = healing (Bite drains life)
            const healAmt=Math.abs(abilityResult.selfDmg);
            const cs2=getCombatStats(gs2);
            playerHp=Math.min(cs2.hp,playerHp+healAmt);
            newLog.push(`  You absorb ${healAmt}hp. Your HP: ${playerHp}`);
          }
          if(abilityResult.skipEnemyTurn)newSkipEnemy=true;
          if(abilityResult.stunEnemy)newStunEnemy=abilityResult.stunRounds||1;
          if(abilityResult.advantage)newAdvantage=true;
          if(abilityResult.halfDmg)newHalfDmg=true;
          if(abilityResult.endCombat){endCombat=true;cashCost=abilityResult.cashCost||0;}
          if(abilityResult.resetCombat){setCombat(null);push(...newLog);return;}
          setAbilityCooldowns(prev=>({...prev,[abilityId]:ability.cooldown}));
        }
      }
    } else {
      // Standard FIGHT — d20 attack roll
      const roll1=roll(20);const roll2=advantage?roll(20):null;
      const attackRoll=advantage?Math.max(roll1,roll2||0):roll1;
      const totalAttack=attackRoll+cs.attackBonus;
      const crit=attackRoll===20;
      const miss=attackRoll===1;
      newLog.push(`⚔ Attack roll: d20=${attackRoll}${advantage?` (adv: ${roll1},${roll2})`:""} +${cs.attackBonus} = ${totalAttack} vs AC ${enemy.ac}`);
      if(miss){
        newLog.push(`  MISS. Fumble.`);
      } else if(crit||totalAttack>=enemy.ac){
        const dmgDice=crit?[roll(6),roll(6),roll(6)]:[roll(6),roll(6)];
        const dmg=dmgDice.reduce((a,b)=>a+b,0)+cs.damageBonus+(crit?4:0);
        enemy={...enemy,hp:Math.max(0,enemy.hp-dmg)};
        newLog.push(`  ${crit?"💥 CRITICAL HIT!":"HIT!"} ${crit?`3d6`:`2d6`}=${dmgDice.join("+")}+${cs.damageBonus}${crit?" +4 crit":""} = ${dmg} damage. ${enemy.name} HP: ${enemy.hp}/${enemy.maxHp}`);
      } else {
        newLog.push(`  MISS. ${enemy.name}'s AC too high (${totalAttack} vs ${enemy.ac}).`);
      }
      newAdvantage=false;
    }

    // ── CHECK ENEMY DEFEAT ──
    if(endCombat||enemy.hp<=0){
      const loot=enemy.loot?rnd(enemy.loot[0],enemy.loot[1]):0;
      const xpGain=enemy.xp||15;
      newLog.push(``,`✓ ${enemy.name} defeated!`,`  +$${loot} · +${xpGain} XP`);
      // chance for gear drop
      const dropRoll=roll(20);
      let droppedItem=null;
      if(dropRoll>=17){
        const rarityRoll=roll(20);
        const pool=rarityRoll>=19?BASE_ITEMS.filter(i=>i.rarity==="rare"):rarityRoll>=15?BASE_ITEMS.filter(i=>i.rarity==="uncommon"):BASE_ITEMS.filter(i=>i.rarity==="common");
        droppedItem=pool[Math.floor(Math.random()*pool.length)];
        if(droppedItem)newLog.push(`  🎁 LOOT DROP: ${ITEM_RARITY[droppedItem.rarity].prefix}${droppedItem.name}! (${droppedItem.slot})`);
      }
      push(...newLog);
      updGs(g=>{
        const ng=applyXP({...g,cash:g.cash+loot-cashCost,
          inventory:droppedItem?[...g.inventory,droppedItem.name]:g.inventory,
          survival:{...g.survival,health:clamp(Math.round(g.survival.health*(playerHp/cs.hp)),1,100)}},xpGain,"fight");
        return ng;
      });
      setCombat(null);
      setAbilityCooldowns(prev=>{const n={};Object.entries(prev).forEach(([k,v])=>{if(v>1)n[k]=v-1;});return n;});
      if(onWin)onWin(loot,droppedItem);
      return;
    }

    // ── ENEMY TURN ──
    if(!newSkipEnemy&&newStunEnemy<=0){
      const eRoll=roll(20);const eTotal=eRoll+enemy.attackBonus;
      newLog.push(``,`${enemy.name} attacks: d20=${eRoll}+${enemy.attackBonus}=${eTotal} vs your AC ${cs.ac}`);
      if(eRoll===20){
        const dmg=roll(enemy.damage[0]||6)*2;
        const taken=newHalfDmg?Math.ceil(dmg/2):dmg;
        playerHp=Math.max(0,playerHp-taken);
        newLog.push(`  💥 CRITICAL HIT! ${taken} damage.${newHalfDmg?" (halved by Endure)":""} Your HP: ${playerHp}`);
      } else if(eRoll===1||eTotal<cs.ac){
        newLog.push(`  MISS. You dodge.`);
      } else {
        const dmg=roll(enemy.damage[0]||6)+Math.floor(enemy.attackBonus/2);
        const taken=newHalfDmg?Math.ceil(dmg/2):dmg;
        playerHp=Math.max(0,playerHp-taken);
        newLog.push(`  HIT! ${taken} damage.${newHalfDmg?" (halved)":""} Your HP: ${playerHp}`);
      }
    } else {
      newLog.push(``,`${enemy.name} ${newStunEnemy>0?"is stunned":"skips turn"}.`);
    }

    // ── CHECK PLAYER DEFEAT ──
    if(playerHp<=0){
      newLog.push(``,`☠ You went down.`,`Lost $${rnd(20,50)}. Heat +2.`);
      push(...newLog);
      updGs(g=>({...g,cash:Math.max(0,g.cash-rnd(20,50)),heat:clamp(g.heat+2,0,10),survival:{...g.survival,health:5}}));
      setCombat(null);if(onLose)onLose();return;
    }

    // ── CONTINUE COMBAT ──
    const archAbilities=COMBAT_ABILITIES[gs2.archetype?.id]||[];
    const availAbils=archAbilities.filter(a=>(abilityCooldowns[a.id]||0)===0);
    newLog.push(``,`HP: ${playerHp} · Enemy HP: ${enemy.hp}/${enemy.maxHp}`,`FIGHT · FLEE${availAbils.length?` · USE [${availAbils.map(a=>a.name).join(" / ")}]`:""}`);
    setCombat({...combat,enemy,round:round+1,log:newLog,playerHp,advantage:newAdvantage,halfDmg:newHalfDmg,skipEnemyTurn:newSkipEnemy,stunEnemy:newStunEnemy,abilitiesUsed});
    push(...newLog.slice(-8)); // show last 8 lines of combat log in feed
    setAbilityCooldowns(prev=>{const n={};Object.entries(prev).forEach(([k,v])=>{if(v>0)n[k]=v-1;});return n;});
  };

  const handleCmd=(e)=>{
    if(e.key!=="Enter"||!cmd.trim())return;
    const raw=cmd.trim();const C=raw.toUpperCase();
    setCmd("");push(`> ${raw}`);
    if(!gs)return;
    // CHAOS ENGINE
    if(gs.isSchizo&&Math.random()<0.20&&C!=="LOOK"&&C!=="HELP"&&C!=="STATUS"&&C!=="SLEEP"&&C!=="VISION"){
      const bad=[
        ()=>{const a=rnd(5,20);updGs(g=>({...g,cash:Math.max(0,g.cash-a)}));push("🌀 You gave $"+a+" to a man who may not have been there.");},
        ()=>{updGs(g=>({...g,heat:clamp(g.heat+1,0,10)}));push("🌀 You said something loud on the street. Heat +1.");},
        ()=>{updGs(g=>({...g,survival:{...gs.survival,energy:clamp(gs.survival.energy-20,0,100)}}));push("🌀 You lost track of time. An hour passed. Energy -20.");},
        ()=>{updGs(g=>({...g,survival:{...gs.survival,hunger:clamp(gs.survival.hunger-20,0,100)}}));push("🌀 You forgot to eat. Again. Hunger -20.");},
        ()=>{updGs(g=>({...g,survival:{...gs.survival,health:clamp(gs.survival.health-10,0,100)}}));push("🌀 You walked into something. Health -10.");},
        ()=>{updGs(g=>({...g,heat:clamp(g.heat+2,0,10)}));push("🌀 You confronted someone about something. They called the cops. Heat +2.");},
      ];
      const neutral=[
        ()=>{setBoro(["bronx","brooklyn","manhattan","queens","staten"][rnd(0,4)]);push("🌀 You ended up in a different borough. You are not sure how.");},
        ()=>{push("🌀 A man you have never met calls you by a name you have never used. He nods. You nod back.");},
        ()=>{push("🌀 You spent twenty minutes arguing with a payphone. You made some good points.");},
        ()=>{push("🌀 You delivered a speech to twelve pigeons. Two of them stayed for the whole thing.");},
      ];
      const good=[
        ()=>{const a=rnd(15,60);updGs(g=>({...g,cash:g.cash+a}));push("🌀 Someone pressed $"+a+" into your hand and walked away fast.");},
        ()=>{updGs(g=>({...g,survival:{...gs.survival,mental:Math.min(100,(gs.survival.mental||70)+25)}}));push("🌀 A moment of perfect clarity. Everything makes sense. Mental +25.");},
        ()=>{updGs(g=>({...g,heat:clamp(g.heat-2,0,10)}));push("🌀 Cops looked at you, looked away, and crossed the street. Heat -2.");},
        ()=>{updGs(g=>({...g,survival:{...gs.survival,health:Math.min(100,gs.survival.health+20)}}));push("🌀 You ate something you found. You feel better actually. Health +20.");},
        ()=>{updGs(g=>({...g,xp:g.xp+50}));push("🌀 You solved something nobody asked you to solve. The answer was correct. +50 XP.");},
      ];
      const roll=Math.random();
      const pool=roll<0.6?bad:roll<0.8?neutral:good;
      pool[rnd(0,pool.length-1)]();
    }
    // advance tutorial on matching commands
    advanceTutorial(C);
    // route combat commands if in combat
    if(combat){
      if(C==="FIGHT"){doCombatRound("fight");return;}
      if(C==="FLEE"){doCombatRound("flee");return;}
      const useM=C.match(/^USE (.+)$/);
      if(useM){
        const archAbilities=COMBAT_ABILITIES[gs.archetype?.id]||[];
        const ability=archAbilities.find(a=>a.name.toLowerCase()===useM[1].toLowerCase()||a.id===useM[1].toLowerCase().replace(/ /g,"_"));
        if(ability){doCombatRound("ability",ability.id);return;}
        push(`Unknown ability. USE [${archAbilities.map(a=>a.name).join(" / ")}]`);return;
      }
      push(`In combat! FIGHT · FLEE · USE [ability]`);return;
    }
    // rare event requires response before anything else
    if(rareEvent){
      const chooseM=C.match(/^CHOOSE ([12])$/);
      if(chooseM){
        const idx=parseInt(chooseM[1])-1;
        const choice=rareEvent.choices[idx];
        if(!choice){push(`Choose 1${rareEvent.choices.length>1?" or 2":""}.`);return;}
        updGs(g=>choice.fn(g));
        push(``,choice.outcome,``);
        setRareEvent(null);
        return;
      }
      push(`⚡ You need to respond to the situation first.`,`Type CHOOSE 1${rareEvent.choices?.[1]?" or CHOOSE 2":""}`);
      return;
    }
    const b=getBoro(boro);
    const weather=getWeather(gs.day);

    // ABILITIES — show archetype combat abilities
    if(C==="ABILITIES"){
      const archAbilities=COMBAT_ABILITIES[gs.archetype?.id]||[];
      push(`— ${gs.archetype?.name} COMBAT ABILITIES —`,...archAbilities.map(a=>{
        const cd=abilityCooldowns[a.id]||0;
        return `  ${a.name}${cd>0?` (cooldown: ${cd}r)`:""} — ${a.desc}`;
      }),``,`USE [ability name] during combat.`);
      return;
    }
    if(C==="HELP"){
      push(`COMMANDS:`,
        `  LOOK · STATUS · INVENTORY · SCOUT · ARBITRAGE · USE · ADDICTION · NEWSPAPER`,`  HUSTLE · REST · EAT · FIGHT · CLAIM`,
        `  BUY [product] [qty] · SELL [product] [qty]`,`  COOK · SELL COOKED [name] [qty]`,
        `  BUY SAFEHOUSE · UPGRADE SAFEHOUSE`,`  STASH [product] · UNSTASH [product] · REST SAFE · STASH CASH · RETRIEVE CASH`,
        `  MOVE [borough] · ATTACK [name] · CAPTAIN · HEAT`,`  BOUNTY [name] [amt] · BOUNTIES · ALERTS`,
        `  FORM CREW [name] · JOIN CREW [name] · LEAVE CREW`,`  CREW · CREWS · DEPOSIT [amt]`,
        `  WANTED · WEATHER · HEAT · TALK [name] · SLEEP · FRONT [prod] [qty] · PAY DEBT`,`  LAY LOW · CHANGE UP · SKIP TOWN · LIE LOW · CONFESS`,`  MSG [text] · MARKET · NPCS · MAP · CHAT`,`  HISTORY · LEGENDS · RETIRE · CHOOSE [1/2]`,
        `  PANHANDLE · SEARCH · SHELTER · CHECKIN · SHELTERS`,`  WORK · TAKE [job] · BODEGA · BUY [item]`,
        `  WRITE [message] · READ LETTERS`,
        gs.isJunkie?`  SCORE — find street product cheap`:"",
        gs.isVampire?`  FEED · MESMERIZE [npc] · MIST [borough] · DOMINATE [player] · THRALL [npc] · NIGHT MARKET · THIRST`:"",
        gs.isFixer?`  WIRE [player] [amt] · BROKER [p1] [p2] · CLEAN [player] · CONNECTIONS · PRICES`:"",
        gs.isRat?`  INFORM [player] · MISINFORM [player] · PLANT [player] · EXPOSE [player] · INTEL · PANIC · RAT STATUS`:"",
        gs.isUndoc?`  CONNECT — tap community network · VANISH — emergency heat dump`:"",
        gs.isHustler?`  FLIP — arbitrage analysis`:"");
      return;
    }

    if(C==="WEATHER"){
      push(`${weather.icon} ${weather.name.toUpperCase()}`,weather.desc,
        `Bust rate: ${weather.bustMult<1?`-${Math.round((1-weather.bustMult)*100)}%`:weather.bustMult>1?`+${Math.round((weather.bustMult-1)*100)}%`:"normal"}`,
        weather.movePenalty>0?`Move penalty: -${weather.movePenalty} energy`:`No move penalty.`);
      return;
    }
    if(C==="LOOK"&&gs.isSchizo){
      const visions=[
        "The pigeons are facing north. That means cops are coming from the south. You have six minutes.",
        "You can see the heat signatures of undercover officers. Wrong shoes. Always the wrong shoes.",
        "The bodega owner is about to throw out good product. You know this because the bottles told you.",
        "A man on the corner has $" + rnd(60,200) + " in his left jacket pocket. You can see the outline through time.",
        "The corner at " + getBoro(boro)?.name + " and nowhere is unguarded. The other players don't know this.",
        "The rats are running east. That's important. You don't know why but it is.",
        "The sidewalk is breathing. You count " + rnd(3,12) + " breaths per minute. Normal.",
        "You see your past self on the corner. He looks disappointed. You look away.",
        "The street signs are in a different language today. You can still read them.",
        "The city grid is a circuit board and you are the signal. You have been the signal this whole time.",
        "There are " + rnd(2,7) + " people within earshot who know your name but won't say it.",
        "The weather is about to change. You can taste it.",
        "You found $" + rnd(5,25) + " on the ground. It was always there. You just had to look with the right eyes.",
        "Someone pressed money into your hand as you walked past. You checked. It was real.",
      ];
      const vision=visions[rnd(0,visions.length-1)];
      if((vision.includes("found $")||vision.includes("pressed money"))&&Math.random()<0.4){
        const cashAmt=rnd(8,30);
        updGs(g=>({...g,cash:g.cash+cashAmt}));
        push("","🌀 VISION",vision,"","(The vision was real. +$"+cashAmt+".)","");
      } else {
        push("","🌀 VISION",vision,"");
      }
      updGs(g=>applyXP(g,2,"look"));return;
    }
    if(C==="LOOK"){
      const wPool=weather.id==="blizzard"?EVTS.blizzard:weather.id==="rain"||weather.id==="storm"?EVTS.rain:weather.id==="heatwave"?EVTS.heatwave:gs.heat>6?EVTS.hot:gs.survival.hunger<30?EVTS.hungry:gs.cash<10?EVTS.broke:EVTS.normal;
      const boroDesc={
        bronx:"The Grand Concourse stretching north, bodegas every half block, the D train rattling somewhere underground.",
        brooklyn:"Atlantic Ave or Flatbush, depending on which way you're walking. Either way it smells like food and someone's argument.",
        manhattan:"Midtown or below 96th, everything costs something, even the air feels monetized.",
        queens:"Jackson Heights or Jamaica, more languages in two blocks than most countries have total.",
        staten:"Quieter here. The ferry terminal smell. Seagulls. A borough that always feels slightly left out.",
      };
      push(`${b.name} — Day ${gs.day} — ${weather.icon} ${weather.name}`,boroDesc[boro]||"",wPool[rnd(0,wPool.length-1)]);
      updGs(g=>applyXP(g,1,"look"));
      // rare event roll on LOOK
      if(!rareEvent){
        const triggered=RARE_EVENTS.find(ev=>Math.random()<ev.prob);
        if(triggered){
          setTimeout(()=>{
            setRareEvent(triggered);
            push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,`⚡ ${triggered.title.toUpperCase()}`,triggered.desc,``,`Type CHOOSE 1${triggered.choices.length>1?` or CHOOSE 2`:``} to respond.`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          },200);
        }
      }
      return;
    }
    if(C==="STATUS"){
      const archId=gs.archetype?.id||"veteran";
      const nextStat=LEVEL_STAT_GROWTH[archId]?.[(gs.level-1)%10]||"?";
      const wt=getWantedTier(Math.round(gs.heat));
      const pw=getCarryWeight(gs.product);
      push(`${gs.name} · Lvl ${gs.level} · Day ${gs.day}${gs.wanted?" · 🚨 WANTED":""}${gs.ghostMode?" · 👻 GHOST":""}`,
        `Cash: $${gs.cash}${gs.cash>MAX_CARRY_CASH?" ⚠ TARGET":""}${gs.cashStash>0?` · Stashed: $${gs.cashStash}`:""}`,
        `Heat: ${Math.round(gs.heat)}/10 · ${wt.stars>0?"★".repeat(wt.stars):"☆"} ${wt.name}`,
        `Cops here: ${getCopPresence(boro,world.copPresence,gs.day)}/10`,
        `XP: ${gs.xp} · Next: ${xpNext(gs.xp)} · Next stat: +${nextStat.toUpperCase()}`,
        `Product: Weed×${gs.product.weed} Pills×${gs.product.pills} Powder×${gs.product.powder} (weight: ${pw.toFixed(1)}/${MAX_CARRY_WEIGHT})`,
        gs.debtOwed>0?`⚠ DEBT: $${gs.debtOwed} — PAY DEBT`:"",
        !gs.isFixer&&!gs.isRat?`Hustles today: ${gs.hustleCount||0}/${HUSTLE_DAILY_MAX[gs.archetype?.id||"veteran"]}${gs.hustleBoroLast===boro&&(gs.hustleBoros?.[boro]||0)>=2?" ⚠ SAME BLOCK PENALTY":""}`:"",
        `Day labor: ${gs.dayJobDone?"Done for today":"Available — type WORK"}`,
        `Crew: ${gs.crew||"solo"} · Corners: ${gs.cornersOwned.join(", ")||"none"}`,
);return;
    }
    if(C==="INVENTORY"){push(`Carrying: ${gs.inventory.join(", ")||"nothing"}.`);return;}
    if(C==="MARKET"){setTab("market");push(`Market open.`);return;}
    if(C==="NPCS")  {setTab("npcs"); push(`Contacts open.`);return;}
    if(C==="MAP")   {setTab("map");  push(`Map open.`);return;}
    if(C==="CHAT")  {setTab("chat"); push(`Chat open.`);return;}
    if(C==="CREWS") {setTab("crews");push(`Crews open.`);return;}

    // SAFE HOUSE commands
    if(C==="BUY SAFEHOUSE")    {setTab("safe");buyOrUpgradeSafe(false);return;}
    if(C==="UPGRADE SAFEHOUSE"){setTab("safe");buyOrUpgradeSafe(true);return;}
    if(C==="REST SAFE"){restSafe();return;}
    const stashM=C.match(/^STASH (\w+)$/);
    if(stashM){stashProduct(stashM[1].toLowerCase());return;}
    const unstashM=C.match(/^UNSTASH (\w+)$/);
    if(unstashM){unstashProduct(unstashM[1].toLowerCase());return;}

    // BUY
    // Support BUY POWDER 2 and BUY 2 POWDER
    const _buyA=C.match(/^BUY ([A-Za-z]+) (\d+)$/);
    const _buyB=C.match(/^BUY (\d+) ([A-Za-z]+)$/);
    const buyM=_buyA||(_buyB?[_buyB[0],_buyB[2],_buyB[1]]:C.match(/^BUY (\w+)(?:\s+(\d+))?$/));
    if(buyM){
      const pKey=buyM[1].toLowerCase();const qty=parseInt(buyM[2])||1;
      if(!PRODUCTS[pKey]){push(`Unknown product. Try: weed, pills, powder.`);return;}
      const sellPrice=mktPrice(boro,pKey,gs.day,weather);
      const buyPrice=Math.round(sellPrice*PRODUCTS[pKey].bm);
      const total=buyPrice*qty;
      // hustler sees spread before committing
      if(gs.isHustler){
        const profit=(sellPrice-buyPrice)*qty;
        push(`💵 Spread: Buy $${buyPrice} · Sell $${sellPrice} · Profit if sold here: $${profit}`);
      }
      if(total>gs.cash){push(`Need $${total}. Have $${gs.cash}.`);return;}
      // hustler gets slight buy discount
      const finalPrice=gs.isHustler?Math.round(total*0.95):total;
      updGs(g=>applyXP({...g,cash:g.cash-finalPrice,product:{...g.product,[pKey]:g.product[pKey]+qty}},5*qty,"deal"));
      push(`Bought ${qty}× ${PRODUCTS[pKey].name} for $${finalPrice}.${gs.isHustler?" (hustler rate)":""}`);return;
    }

    // SELL — weather affects bust rate
    // SELL COOKED — must be checked before generic SELL
    const scM2=raw.match(/^[Ss][Ee][Ll][Ll] [Cc][Oo][Oo][Kk][Ee][Dd] (.+?)(?:\s+(\d+))?$/);
    if(scM2){
      const rName2=scM2[1].trim().toLowerCase();const qty2=parseInt(scM2[2])||1;const recipe2=RECIPES[rName2];
      if(!recipe2){
        // list what they have cooked
        const cookedList=Object.entries(gs.cooked||{}).filter(([,v])=>v>0);
        push(`Unknown recipe "${rName2}".`,cookedList.length?`You have cooked: ${cookedList.map(([n,q])=>n+" x"+q).join(", ")}`:`Nothing cooked. Type COOK to see recipes.`);return;
      }
      const held2=(gs.cooked||{})[rName2]||0;if(held2<qty2){push(`Only have ${held2} ${rName2}.`);return;}
      const price2=Math.round(mktPrice(boro,recipe2.base,gs.day,weather)*recipe2.sellX);
      const total2=price2*qty2;const hg2=rnd(1,3);
      updGs(g=>applyXP({...g,cash:g.cash+total2,cooked:{...g.cooked,[rName2]:held2-qty2},heat:clamp(g.heat+hg2,0,10)},12*qty2,"deal"));
      push(`${recipe2.icon} Sold ${qty2}x ${rName2}. +$${total2}. Heat +${hg2}.`);return;
    }
    // Also: SELL [recipe name] works as shorthand for cooked products
    const sellM=C.match(/^SELL (\w+)(?:\s+(\d+))?$/);
    if(sellM){
      const pKey=sellM[1].toLowerCase();const qty=parseInt(sellM[2])||1;
      // Check if it's a cooked product first
      if(RECIPES[pKey]&&(gs.cooked||{})[pKey]>0){
        const recipe3=RECIPES[pKey];const held3=(gs.cooked||{})[pKey]||0;
        const qty3=Math.min(qty,held3);
        const total3=Math.round(mktPrice(boro,recipe3.base,gs.day,weather)*recipe3.sellX)*qty3;const hg3=rnd(1,3);
        updGs(g=>applyXP({...g,cash:g.cash+total3,cooked:{...g.cooked,[pKey]:held3-qty3},heat:clamp(g.heat+hg3,0,10)},12*qty3,"deal"));
        push(`${recipe3.icon} Sold ${qty3}x ${pKey}. +$${total3}.`);return;
      }
      if(!PRODUCTS[pKey]){push(`Unknown. Try: weed, pills, powder. For cooked: SELL COOKED [name].`);return;}
      if(gs.product[pKey]<qty){push(`Only have ${gs.product[pKey]}.`);return;}
      const price=mktPrice(boro,pKey,gs.day,weather);const total=price*qty;
      const hg=Math.round(qty*PRODUCTS[pKey].rm*(b.heat/10));
      const bustChance=gs.heat+hg>8?0.3*weather.bustMult:0;
      const caught=bustChance>0&&Math.random()<bustChance;
      if(caught){
        updGs(g=>({...g,product:{...g.product,[pKey]:0},heat:clamp(g.heat+3,0,10),cash:Math.max(0,g.cash-50)}));
        push(`BUSTED. Product gone. -$50.`);return;
      }
      updGs(g=>applyXP({...g,cash:g.cash+total,product:{...g.product,[pKey]:g.product[pKey]-qty},heat:clamp(g.heat+hg,0,10)},8*qty,"deal"));
      // update world supply data so prices respond
      const supplyWs={...world,supply:{...world.supply,[`${boro}_${pKey}`]:((world.supply||{})[`${boro}_${pKey}`]||0)+qty}};
      const actWs=broadcastActivity(supplyWs,`${gs.name} moved ${qty}x ${PRODUCTS[pKey].name} in ${getBoro(boro)?.name}. +$${total}.`,"💊");
      setWorld(actWs);saveWorld(actWs);
      const archSub=CLASS_SUBSTANCE[gs.archetype?.id||"veteran"];
      if(archSub?.product===pKey){updGs(g=>({...g,addiction:Math.min(100,g.addiction+rnd(1,3))}));}
      push(`Moved ${qty}× ${PRODUCTS[pKey].name}. +$${total}${weather.bustMult<1?" (weather helped)":""}.`);return;
    }

    // COOK
    if(C==="COOK"){push(`Cook recipes:`,...Object.entries(RECIPES).map(([k,r])=>`  ${r.icon} ${k}: ${r.desc}`),`Usage: COOK [name]`);return;}
    const cookM=raw.match(/^[Cc][Oo][Oo][Kk] (.+)$/);
    if(cookM){
      const rName=cookM[1].trim().toLowerCase();const recipe=RECIPES[rName];
      if(!recipe){push(`Unknown recipe.`);return;}
      const miss=Object.entries(recipe.inputs).find(([k,q])=>(gs.product[k]||0)<q);
      if(miss){push(`Need ${miss[1]} ${miss[0]}. Have ${gs.product[miss[0]]||0}.`);return;}
      const np={...gs.product};Object.entries(recipe.inputs).forEach(([k,q])=>{np[k]-=q;});
      const nc={...(gs.cooked||{}),[rName]:((gs.cooked||{})[rName]||0)+1};
      updGs(g=>applyXP({...g,product:np,cooked:nc},15,"cook"));
      push(`${recipe.icon} Cooked 1 ${rName}. Sells at ${recipe.sellX}x.`);return;
    }
    // SELL COOKED handled above

    if(C==="HUSTLE"){
      if(gs.survival.energy<20){push(`Too tired. REST first.`);return;}
      // Fixer and Rat have better alternatives
      if(gs.isFixer){push(`Fixers don't hustle. BROKER deals or WIRE cash instead.`);return;}
      if(gs.isRat&&!gs.isUndoc){push(`Hustling draws attention. INFORM your handler instead — safer money.`);return;}

      // Daily cap check
      const archId=gs.archetype?.id||"veteran";
      const maxHustles=HUSTLE_DAILY_MAX[archId]||3;
      const todayCount=gs.hustleCount||0;
      if(todayCount>=maxHustles){
        push(`You've worked this block all day. Nobody's paying anymore.`,`Come back tomorrow or move to a different borough.`);return;
      }

      // Same borough penalty
      const sameBoro=gs.hustleBoroLast===boro;
      const boroCount=(gs.hustleBoros||{})[boro]||0;
      const sameBoroPenalty=boroCount>=2;

      // Diminishing returns
      const payoutMult=HUSTLE_PAYOUT_MULT[Math.min(todayCount,HUSTLE_PAYOUT_MULT.length-1)];
      const attemptsLeft=maxHustles-todayCount-1;

      // Archetype-specific hustle style
      const hustleStyle = {
        veteran:      {failRate:0.2, heatRate:2,  basePay:[10,30], flavorOk:[`You step to someone. Your posture says everything that needs saying. They don't argue. Money changes hands.`,`Word travels on this block. Someone pointed you out to someone who needed a problem solved. You solved it.`,`Twenty-two years of training and they send you out here for this. You do it anyway. Cash is cash.`], flavorFail:[`Too aggressive, wrong read on the situation. Someone dialed. You need to move.`]},
        schemer:      {failRate:0.15,heatRate:1,  basePay:[8,28],  crit:true, flavorOk:[`Three-card monte on the corner of 42nd. You've done this so many times the cards feel like extensions of your hands. Clean.`,`You spot the mark from forty feet away. Wrong city, right outfit. You give them a story so good you almost believe it yourself.`,`Small con, quick payout, nobody the wiser. The city has a hundred of these running at any given moment. You're just one more.`], flavorFail:[`You read him wrong. He read you right. You walked before it escalated.`]},
        ghost:        {failRate:0.1, heatRate:0,  basePay:[7,22],  flavorOk:[`You work the edges. The spaces between where people look. Quiet money. Nobody saw you because nobody ever sees you.`,`In and out. Cash in hand. No trace, no heat, no story. The way you prefer it.`,`While they were watching the corner you were behind them. That's always been the advantage.`], flavorFail:[`Nothing doing today. The invisible work sometimes yields nothing. You stay invisible anyway.`]},
        hustler:      {failRate:0.15,heatRate:1,  basePay:[12,35], flavorOk:[`Pure grind. You know every angle.`,`Markets, deliveries, whatever pays. You don't stop.`], flavorFail:[`Dry today. Happens.`]},
        junkie:       {failRate:0.35,heatRate:2,  basePay:[6,18],  flavorOk:[`People give you things. You're not sure why.`,`Scratch work. Not glamorous.`], flavorFail:[`Can't focus today. Nothing came of it.`]},
        undocumented: {failRate:0.2, heatRate:0,  basePay:[8,20],  flavorOk:[`Community work. Day labor. Cash in hand.`,`Word of mouth job. Done by noon.`], flavorFail:[`Too much attention on the block today.`]},
        vampire:      {failRate:0.4, heatRate:3,  basePay:[5,15],  flavorOk:[`You charm someone into paying you. They feel strange after.`], flavorFail:[`Daylight. You're too exposed.`]},
        fixer:        {failRate:0,   heatRate:0,  basePay:[0,0],   flavorOk:[], flavorFail:[]},
        rat:          {failRate:0,   heatRate:0,  basePay:[0,0],   flavorOk:[], flavorFail:[]},
      };
      const style=hustleStyle[archId]||hustleStyle.veteran;
      const failChance=style.failRate+(sameBoroPenalty?0.15:0);
      const ok=Math.random()>failChance;

      if(ok){
        let base=rnd(style.basePay[0],style.basePay[1])+gs.stats.hustle;
        base=Math.round(base*payoutMult);
        // Schemer crit — 20% chance 2x on first hustle
        if(style.crit&&todayCount===0&&Math.random()<0.2){
          base=base*2;
          push(style.flavorOk[rnd(0,style.flavorOk.length-1)],`💥 Crit! Double payout. +$${base}.`);
        } else {
          push(style.flavorOk[rnd(0,style.flavorOk.length-1)],
            `+$${base}.${payoutMult<1?` (${Math.round(payoutMult*100)}% — block's drying up)`:""}`,
            attemptsLeft>0?`${attemptsLeft} hustle${attemptsLeft>1?"s":""} left today.`:`Last hustle today. Rest or move.`);
        }
        const hg=sameBoroPenalty?style.heatRate+HUSTLE_SAME_BORO_HEAT:style.heatRate;
        updGs(g=>applyXP({...g,
          cash:g.cash+base,
          heat:clamp(g.heat+rnd(0,hg),0,10),
          hustleCount:(g.hustleCount||0)+1,
          hustleBoroLast:boro,
          hustleBoros:{...(g.hustleBoros||{}),[boro]:((g.hustleBoros||{})[boro]||0)+1},
          survival:{...g.survival,energy:clamp(g.survival.energy-15,0,100)},
        },10,"hustle"));
      } else {
        push(style.flavorFail[rnd(0,style.flavorFail.length-1)]||`Nothing gained.`,
          sameBoroPenalty?`Same block again. Heat +${style.heatRate+HUSTLE_SAME_BORO_HEAT}.`:`Heat +1.`);
        const hg=sameBoroPenalty?style.heatRate+HUSTLE_SAME_BORO_HEAT:1;
        updGs(g=>({...g,
          heat:clamp(g.heat+hg,0,10),
          hustleCount:(g.hustleCount||0)+1,
          hustleBoroLast:boro,
          hustleBoros:{...(g.hustleBoros||{}),[boro]:((g.hustleBoros||{})[boro]||0)+1},
          survival:{...g.survival,energy:clamp(g.survival.energy-10,0,100)},
        }));
      }
      return;
    }
    if(C==="REST"){
      // undocumented can't use shelters but can rest in community spots
      const restBonus=gs.isUndoc?0:5;
      updGs(g=>applyXP({...g,survival:{hunger:clamp(g.survival.hunger-8,0,100),warmth:clamp(g.survival.warmth+15,0,100),health:clamp(g.survival.health+restBonus,0,100),energy:clamp(g.survival.energy+40,0,100)},heat:clamp(g.heat-1,0,10)},3,"rest"));
      push(gs.isUndoc?`You find a spot in a community space. Can't risk a shelter.`:`Found cover. Laid low.`,`Energy up. Heat cooling.`);return;
    }
    if(C==="EAT"){
      if(gs.isVampire){push(`Food does nothing for you. FEED to restore health.`);return;}
      if(gs.cash<2){push(`Broke. Can't even afford bodega prices.`);return;}
      const sp=Math.min(15,gs.cash);
      updGs(g=>({...g,cash:g.cash-sp,survival:{...g.survival,hunger:clamp(g.survival.hunger+sp*3,0,100)}}));
      push(`Grabbed something from the bodega. -$${sp}. Hunger up.`);return;
    }

    // BODEGA — browse and buy bodega items
    if(C==="BODEGA"){
      push(``,`🏪 BODEGA — ${getBoro(boro)?.name}`,``,
        ...Object.entries(BODEGA_ITEMS).map(([key,item])=>`  ${item.name.padEnd(16)} $${item.price}  ${item.desc}`),
        ``,`BUY [item] to purchase. e.g. BUY COFFEE · BUY BEER · BUY METROCARD`);
      return;
    }

    // BUY [bodega item] — override to check bodega first
    const bodbuyM=C.match(/^BUY (COFFEE|SANDWICH|CHIPS|WATER|BEER|CIGARETTES|ASPIRIN|SOUP|METROCARD|ENERGYDRINK|HOTDOG|LARGE COFFEE|ENERGY DRINK|HOT DOG|LARGE)$/);
    if(bodbuyM){
      const itemKey=Object.keys(BODEGA_ITEMS).find(k=>
        k===bodbuyM[1].toLowerCase()||
        BODEGA_ITEMS[k].name.toLowerCase()===bodbuyM[1].toLowerCase()||
        BODEGA_ITEMS[k].name.toLowerCase().includes(bodbuyM[1].toLowerCase())
      );
      const bItem=itemKey?BODEGA_ITEMS[itemKey]:null;
      if(bItem){
        if(gs.cash<bItem.price){push(`Need $${bItem.price}. Have $${gs.cash}.`);return;}
        updGs(g=>{
          let ng={...g,cash:g.cash-bItem.price};
          const eff=bItem.effect||{};
          if(eff.hunger!==undefined)ng={...ng,survival:{...ng.survival,hunger:Math.min(100,ng.survival.hunger+(eff.hunger||0))}};
          if(eff.energy!==undefined)ng={...ng,survival:{...ng.survival,energy:Math.min(100,ng.survival.energy+(eff.energy||0))}};
          if(eff.warmth!==undefined)ng={...ng,survival:{...ng.survival,warmth:Math.min(100,ng.survival.warmth+(eff.warmth||0))}};
          if(eff.health!==undefined)ng={...ng,survival:{...ng.survival,health:clamp(ng.survival.health+(eff.health||0),0,100)}};
          if(eff.mental!==undefined)ng={...ng,survival:{...ng.survival,mental:Math.min(100,(ng.survival.mental||70)+(eff.mental||0))}};
          // addiction from beer/cigarettes
          if(bItem.addictive){
            const archSub=CLASS_SUBSTANCE[ng.archetype?.id||"veteran"];
            if(archSub?.name===bItem.substance||bItem.substance==="cigarettes"){
              ng={...ng,addiction:Math.min(100,ng.addiction+2)};
            }
          }
          // metrocard — next move free energy
          if(bItem.special==="transit")ng={...ng,hasMetrocard:true};
          return ng;
        });
        const bMsgs={
          coffee:["You take the first sip standing at the counter. It's bad coffee. It's also exactly what you needed.","The bodega guy knows your order. You didn't tell him. He just knows."],
          beer:["The 40 goes down warm. The block softens a little.","You find a stoop. Sit. The city moves around you without caring."],
          cigarettes:["First drag in how long? You exhale slowly. Something in your chest unclenches.","You smoke half and put the rest behind your ear for later."],
          metrocard:["You tap through the turnstile. The train is running. Small miracle.","Underground. Nobody can see you down here. Sometimes that's exactly what you need."],
        };
        const bMsg=bMsgs[itemKey]?bMsgs[itemKey][rnd(0,bMsgs[itemKey].length-1)]:null;
        push(`🏪 ${bItem.name} — $${bItem.price}`,bMsg||bItem.desc,`${Object.entries(bItem.effect||{}).filter(([,v])=>v!==0).map(([k,v])=>`${k} ${v>0?"+":""}${v}`).join(" · ")}`);
        return;
      }
    }
    // SCOUT DOG — drifter special
    if(C==="SCOUT DOG"||C==="DOG SCOUT"){
      if(!gs.isDrifter){push(`Only the Drifter has a dog.`);return;}
      if(gs.survival.energy<10){push(`Your dog is tired too.`);return;}
      const copLvl=getCopPresence(boro,world.copPresence,gs.day);
      const patrolActive=Math.random()<(gs.heat/10)*0.5;
      const msgs=[
        `Your dog trots around the block and comes back. Tail wagging — no cops nearby.`,
        `Your dog sniffs out two plainclothes near the bodega. You know to avoid 3rd Ave.`,
        `Your dog freezes halfway down the block. Hackles up. You pull back. Good call.`,
        `Clean block. Your dog found a half sandwich and you let them have it.`,
      ];
      push(`🐕 SCOUT DOG`,msgs[rnd(0,msgs.length-1)],
        `Cop presence here: ${copLvl}/10. ${patrolActive?"⚠ Patrol active.":"Clear for now."}`);
      updGs(g=>({...g,survival:{...g.survival,energy:clamp(g.survival.energy-5,0,100)}}));return;
    }
    if(C==="SCOUT"){
      push(`Intel — ${b.name} ${weather.icon}:`,
        `  Weed $${mktPrice(boro,"weed",gs.day,weather)}/bag`,`  Pills $${mktPrice(boro,"pills",gs.day,weather)}/pack`,
        `  Powder $${mktPrice(boro,"powder",gs.day,weather)}/g`,
        `  Corner: ${world.corners?.[boro]||"unclaimed"}`,`  Safe house: ${world.safehouses?.[boro]?`owned by ${world.safehouses[boro].owner||world.safehouses[boro].crewOwner}`:"none"}`);
      updGs(g=>applyXP(g,8,"scout"));return;
    }

    // MOVE — blizzard/storm adds energy penalty
    const mvM=C.match(/^MOVE (.+)$/);
    if(mvM){
      const _mvIn=mvM[1].toLowerCase().replace(/^the /,'').trim();const t=BOROUGHS.find(bx=>bx.name.toLowerCase().includes(_mvIn)||bx.id===_mvIn||bx.short.toLowerCase()===_mvIn||_mvIn.includes(bx.id));
      if(!t){push(`Unknown borough.`);return;}if(t.id===boro){push(`Already in ${t.name}.`);return;}
      const penalty=10+weather.movePenalty;
      if(gs.survival.energy<penalty){push(`Too tired to travel. Need ${penalty} energy. REST first.`);return;}
      setBoro(t.id);
      const wPool=weather.id==="blizzard"?EVTS.blizzard:weather.id==="rain"||weather.id==="storm"?EVTS.rain:EVTS.normal;
      // Entry check for high wanted tier or restricted boroughs
      const tier2=getWantedTier(Math.round(gs.heat));
      if(tier2.cantEnter.includes(t.id)){
        push(`🚔 You're too hot for ${t.name}. Wanted tier: ${tier2.name}.`,`Cool down first or find another route.`);return;
      }
      // Product weight penalty on move
      const moveWeight=getCarryWeight(gs.product);
      const weightPenalty=Math.floor(Math.max(0,moveWeight-MAX_CARRY_WEIGHT)*3);
      const totalMovePenalty=gs.hasMetrocard?0:10+weather.movePenalty+weightPenalty+(tier2.movePenalty||0);
      if(gs.hasMetrocard&&totalMovePenalty===0)push(`🚇 MetroCard — free ride.`);
      if(gs.survival.energy<totalMovePenalty){push(`Too tired to make that trip. Need ${totalMovePenalty} energy.`);return;}
      // Entry cop check — high cop presence boroughs can stop you
      const destCopPresence=getCopPresence(t.id,world.copPresence,gs.day);
      const entryRisk=(gs.heat/10)*(destCopPresence/10);
      if(Math.random()<entryRisk*0.3){
        push(`🚔 Stopped at the border of ${t.name}.`,PATROL_EVENTS[rnd(0,PATROL_EVENTS.length-1)],`HIDE · RUN · BRIBE · TALK`);
        updGs(g=>({...g,patrolEncountered:true,survival:{...g.survival,energy:clamp(g.survival.energy-5,0,100)}}));
        return;
      }
      if(gs.isSchizo&&Math.random()<0.25){
        const tv=["The train announcements are addressing you specifically.","Someone on the platform knows your name.","The subway map rearranged itself while you were looking.","You arrived before you left. You checked."];
        push(tv[rnd(0,tv.length-1)]);
      }
      push(`You head to ${t.name}. ${weather.movePenalty>0?`Rough going in this weather.`:""}`,wPool[rnd(0,wPool.length-1)]);
      updGs(g=>{const np={...g.questProgress};Object.keys(g.activeQuests||{}).forEach(qid=>{const v=np[qid]?.visited||[];if(!v.includes(t.id))np[qid]={...(np[qid]||{}),visited:[...v,t.id]};});return{...g,questProgress:np};});
      updGs(g=>applyXP({...g,survival:{...g.survival,energy:clamp(g.survival.energy-penalty,0,100)}},5,"move"));
      const ws={...world,players:{...(world.players||{}),[gs.name]:{level:gs.level,borough:t.id,lastSeen:Date.now(),heat:Math.round(gs.heat)}}};
      setWorld(ws);saveWorld(ws);return;
    }

    // CLAIM
    if(C==="CLAIM"){
      const cur=world.corners?.[boro];if(cur===gs.name){push(`You already own this.`);return;}
      if(gs.stats.hustle+gs.level<8){push(`Not enough rep yet.`);return;}
      if(cur){push(`${cur} owns this. ATTACK them first.`);return;}
      let ws=addWorldHistory(world,"corner",gs.name,`${gs.name} claimed ${getBoro(boro)?.name} corner`,boro);
      ws=notifyPlayers(ws,gs.name,`🚩 ${gs.name} just claimed ${getBoro(boro)?.name} corner.`);
      ws=broadcastActivity(ws,`${gs.name} locked down ${getBoro(boro)?.name}. Corner claimed.`,"🚩");
      ws={...ws,corners:{...ws.corners,[boro]:gs.name}};setWorld(ws);saveWorld(ws);setWMsgs(ws.messages||[]);
      updGs(g=>applyXP({...g,cornersOwned:[...g.cornersOwned,boro]},30,"claim"));
      push(`You claimed ${b.name} corner.`);journalEvent('firstCorner',boro);return;
    }
    if(C==="FIGHT"){
      // pick random street enemy
      const types=["thug","dealer","thug","thug","enforcer"];
      const eType=types[Math.floor(Math.random()*types.length)];
      const enemy=ENEMIES[eType];
      const fightIntros=["steps into your path like he's been waiting.",
        "comes off the wall like he had you marked already.",
        "walks toward you with the kind of purpose that means this isn't random.",
        "squares up. Nothing personal. Just math.",
      ];
      push(``,`⚔ ${enemy.name} ${fightIntros[rnd(0,fightIntros.length-1)]}`,``,`${enemy.desc}`,``,`FIGHT · FLEE · USE [ability]`);
      resolveCombat(gs,eType,
        (loot)=>{const isBossWin=ENEMIES[enemyType]?.boss;
      const endMsgs=isBossWin?[ENEMIES[enemyType].winMsg||"Boss down."]:["Over. You walk away.","Done. They will not try that again.","You end it before it gets worse."];
      push("",endMsgs[rnd(0,endMsgs.length-1)]);
      if(isBossWin){
        const bWs=broadcastActivity(world,gs.name+" just dropped "+ENEMIES[enemyType].name+" in "+getBoro(boro)?.name+". BOSS DOWN.","👹");
        const bWs2=addWorldHistory(bWs,"boss",gs.name,gs.name+" defeated "+ENEMIES[enemyType].name+" on Day "+gs.day+".",boro);
        setWorld(bWs2);saveWorld(bWs2);
      }updGs(g=>{const np={...g.questProgress};Object.keys(g.activeQuests||{}).forEach(qid=>{np[qid]={...(np[qid]||{}),fights:(np[qid]?.fights||0)+1};});return{...g,questProgress:np};});},
        ()=>{const loseMsgs=[`You hit the ground. They took something. Find somewhere to recover.`,`Bad read. They were ready. Get somewhere safe.`,`Didn't go your way. The city doesn't care. Keep moving.`];push(loseMsgs[rnd(0,loseMsgs.length-1)]);},
        ()=>{const fleeMsgs=[`You get out. Barely, but you get out.`,`Gone before they can regroup. Smart.`,`Slip away into the block. They don't follow.`];push(fleeMsgs[rnd(0,fleeMsgs.length-1)]);}
      );
      return;
    }

    // ATTACK [player] — D&D PvP
    const atkM=C.match(/^ATTACK (.+)$/);
    if(atkM){
      const tName=raw.slice(7).trim();const tData=world.players?.[tName];
      if(!tData){push(`Don't know ${tName}.`);return;}
      if(tData.borough!==boro){push(`${tName} isn't in ${b.name}.`);return;}
      if(tName===gs.name){push(`Can't attack yourself.`);return;}
      if(gs.survival.health<20){push(`Too hurt. Patch up first.`);return;}
      // D&D style PvP
      const myCS=getCombatStats(gs);
      const theirAC=10+(tData.level||1)+(tData.toughness||0);
      const attackRoll=roll(20);const totalAttack=attackRoll+myCS.attackBonus;
      const crit=attackRoll===20;const miss=attackRoll===1;
      let won=false;let stolen=0;let log=[];
      log.push(`⚔ You jump ${tName}.`,`Attack roll: d20=${attackRoll}+${myCS.attackBonus}=${totalAttack} vs their AC ${theirAC}`);
      if(!miss&&(crit||totalAttack>=theirAC)){
        won=true;
        const dmg=crit?roll(6)*3+myCS.damageBonus:roll(6)*2+myCS.damageBonus;
        stolen=rnd(20,Math.max(25,Math.floor((tData.cash||50)*0.3)));
        log.push(`${crit?"💥 CRITICAL!":"HIT!"} ${dmg} damage. You take $${stolen}.`);
      } else {
        log.push(`MISS. They were ready. You take damage retreating.`);
      }
      const hg=rnd(2,4);const selfDmg=won?rnd(5,15):rnd(15,30);
      const cornerStolen=won&&world.corners?.[boro]===tName;
     const tBounty=world.bounties?.[tName];
        const bAmt2=tBounty&&typeof tBounty==="object"?tBounty.amount:tBounty||0;
        if(won&&bAmt2>0){
          const bc3={...world.bounties};delete bc3[tName];
          const bcW3=broadcastActivity({...world,bounties:bc3},gs.name+" collected $"+bAmt2+" bounty on "+tName+".","💰");
          setWorld(bcW3);saveWorld(bcW3);
          updGs(g=>({...g,cash:g.cash+bAmt2}));
          push("💰 Bounty collected! +$"+bAmt2+".");
        }
         const ws={...world,pvpLog:[...(world.pvpLog||[]).slice(-29),{attacker:gs.name,victim:tName,won,stolen,boro,time:Date.now()}],
        corners:{...world.corners,...(cornerStolen?{[boro]:gs.name}:{})},
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`⚠ ${gs.name} attacked you in ${b.name}. Attack roll ${totalAttack}. ${won?`Lost $${stolen}.`:"They missed."}`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      if(won){
        updGs(g=>applyXP({...g,cash:g.cash+stolen,heat:clamp(g.heat+hg,0,10),survival:{...g.survival,health:clamp(g.survival.health-selfDmg,0,100)},cornersOwned:cornerStolen?[...g.cornersOwned,boro]:g.cornersOwned},25,"fight"));
        let wsh=addWorldHistory(world,"pvp",gs.name,`${gs.name} robbed ${tName} in ${getBoro(boro)?.name} (d20=${attackRoll}, +$${stolen})`,boro);
        wsh=notifyPlayers(wsh,gs.name,`🔴 ${gs.name} rolled ${attackRoll} attacking ${tName} in ${getBoro(boro)?.name}. +$${stolen}.`);
        wsh=broadcastActivity(wsh,`${gs.name} put hands on ${tName} in ${getBoro(boro)?.name}. ${won?`$${stolen} taken.`:"Didn't go as planned."}`,"⚔");
        setWorld(wsh);saveWorld(wsh);setWMsgs(wsh.messages||[]);
        if(cornerStolen)log.push(`Corner taken.`);
      } else {
        updGs(g=>({...g,cash:Math.max(0,g.cash-rnd(10,20)),heat:clamp(g.heat+hg,0,10),survival:{...g.survival,health:clamp(g.survival.health-selfDmg,0,100)}}));
      }
      push(...log);return;
    }

    // BOUNTY
    const bnM=C.match(/^BOUNTY (\S+) (\d+)$/);
    if(bnM){const amt=parseInt(bnM[2]);if(amt<10){push(`Min $10.`);return;}if(amt>gs.cash){push(`Don't have $${amt}.`);return;}
      const ws={...world,bounties:{...(world.bounties||{}),[bnM[1]]:((world.bounties||{})[bnM[1]]||0)+amt}};setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,cash:g.cash-amt}));push(`$${amt} bounty on ${bnM[1]}.`);return;}
    if(C==="BOUNTIES"||C==="BOUNTY BOARD"){
      const e=Object.entries(world.bounties||{}).filter(([,v])=>typeof v==="object"?v.amount>0:v>0);
      push("","☠ BOUNTY BOARD","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ...(e.length?e.map(([n,b])=>{const amt=typeof b==="object"?b.amount:b;const poster=typeof b==="object"?b.by:"anon";return "  "+n+": $"+amt+" — by "+poster;}):[" None active. BOUNTY [player] [amount] to post."]),
        "","Minimum $50. Collect by winning a FIGHT against the target.");return;
    }
    const bountySetM=C.match(/^BOUNTY ([A-Za-z0-9_]+) (\d+)$/);
    if(bountySetM){
      const bTarget=bountySetM[1];const bAmt=parseInt(bountySetM[2]);
      if(bTarget.toLowerCase()===gs.name.toLowerCase()){push("Cannot bounty yourself.");return;}
      if(bAmt<50){push("Minimum $50.");return;}
      if(gs.cash<bAmt){push("Need $"+bAmt+".");return;}
      if(!world.players?.[bTarget]){push(bTarget+" not in this world.");return;}
      const existing=world.bounties?.[bTarget];
      const existingAmt=typeof existing==="object"?existing.amount:existing||0;
      const newBounty={amount:existingAmt+bAmt,by:gs.name,postedDay:gs.day};
      const bws={...world,bounties:{...(world.bounties||{}),[bTarget]:newBounty}};
      const bws2=broadcastActivity(bws,gs.name+" posted $"+bAmt+" bounty on "+bTarget+". Collect it.","☠");
      const bws3=notifyPlayers(bws2,gs.name,"☠ "+gs.name+" put a $"+bAmt+" bounty on your head.");
      updGs(g=>({...g,cash:g.cash-bAmt}));setWorld(bws3);saveWorld(bws3);
      push("☠ $"+bAmt+" bounty on "+bTarget+". Live on the board.");return;
    }
    if(C==="ALERTS"){const al=(world.playerAlerts||{})[gs.name]||[];if(!al.length){push(`No alerts.`);return;}
      push(`Alerts:`,...al.slice(-5).map(a=>a.msg));
      const ws={...world,playerAlerts:{...(world.playerAlerts||{}),[gs.name]:[]}};setWorld(ws);saveWorld(ws);return;}
    if(C==="WANTED"){
      const wp=Object.entries(world.players||{}).filter(([,d])=>d.heat>=9);
      push(`Wanted:`,...(wp.length?wp.map(([n,d])=>`  🚨 ${n} · Lvl ${d.level} · ${getBoro(d.borough)?.short}`):[`  Nobody.`]));
      const dead=world.wallOfDead||[];if(dead.length)push(`Wall:`,...dead.slice(-5).reverse().map(d=>`  ☠ ${d.name} · Lvl ${d.level} · Day ${d.day}`));return;}

    // CREW
    const fcM=C.match(/^FORM CREW (.+)$/);
    if(fcM){const cN=raw.slice(10).trim();if(gs.crew){push(`Leave ${gs.crew} first.`);return;}if(gs.level<2){push(`Need Level 2.`);return;}
      if(world.crews?.[cN]){push(`"${cN}" exists.`);return;}
      let ws=addWorldHistory(world,"crew",gs.name,`${gs.name} founded crew "${cN}"`,boro);
      ws=notifyPlayers(ws,gs.name,`👥 New crew on the streets: "${cN}" founded by ${gs.name}.`);
      ws={...ws,crews:{...(ws.crews||{}),[cN]:{founder:gs.name,members:[gs.name],bank:0}}};
      setWorld(ws);saveWorld(ws);setWMsgs(ws.messages||[]);
      updGs(g=>({...g,crew:cN,crewRole:"founder"}));push(`Crew "${cN}" live.`);return;}
    const jcM=C.match(/^JOIN CREW (.+)$/);
    if(jcM){const cN=raw.slice(10).trim();if(gs.crew){push(`Leave first.`);return;}const crew=world.crews?.[cN];if(!crew){push(`No crew "${cN}".`);return;}
      const ws={...world,crews:{...world.crews,[cN]:{...crew,members:[...crew.members,gs.name]}}};setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,crew:cN,crewRole:"member"}));push(`Joined ${cN}.`);journalEvent('firstCrew',cN);return;}
    if(C==="LEAVE CREW"){if(!gs.crew){push(`Not in a crew.`);return;}const crew=world.crews?.[gs.crew];
      if(crew){const ws={...world,crews:{...world.crews,[gs.crew]:{...crew,members:crew.members.filter(m=>m!==gs.name)}}};setWorld(ws);saveWorld(ws);}
      updGs(g=>({...g,crew:null,crewRole:null}));push(`You walked.`);return;}
    if(C==="CREW"){if(!gs.crew){push(`Not in a crew.`);return;}const crew=world.crews?.[gs.crew];
      push(`${gs.crew}`,`Founder: ${crew?.founder}`,`Members: ${crew?.members?.join(", ")}`,`Bank: $${crew?.bank||0}`);return;}
    const depM=C.match(/^DEPOSIT (\d+)$/);
    if(depM){if(!gs.crew){push(`Not in a crew.`);return;}const amt=parseInt(depM[1]);if(amt>gs.cash){push(`Don't have $${amt}.`);return;}
      const crew=world.crews?.[gs.crew];if(!crew){push(`Crew not found.`);return;}
      const ws={...world,crews:{...world.crews,[gs.crew]:{...crew,bank:(crew.bank||0)+amt}}};setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,cash:g.cash-amt}));push(`Deposited $${amt}. Bank: $${(crew.bank||0)+amt}.`);return;}

    // TALK
    const tlkM=C.match(/^TALK (.+)$/);
    if(tlkM){const nN=tlkM[1].toLowerCase();const npc=npcs.find(n=>n.name.toLowerCase()===nN||n.id===nN);
      if(!npc){push(`Don't know ${tlkM[1]}.`);return;}if(npc.b!==boro){push(`${npc.name} isn't here. Try ${getBoro(npc.b)?.name}.`);return;}
      // dynamic dialogue based on rep
      const npcRep=npc.rep||0;
      const deepLines=NPC_DEEP_DIALOGUE[npc.id];
      let dialogueLine=npc.lines[rnd(0,npc.lines.length-1)];
      if(deepLines){
        if(npcRep>=10&&deepLines[10]){dialogueLine=deepLines[10][rnd(0,deepLines[10].length-1)];}
        else if(npcRep>=8&&deepLines[8]){dialogueLine=deepLines[8][rnd(0,deepLines[8].length-1)];}
        else if(npcRep>=5&&deepLines[5]){dialogueLine=deepLines[5][rnd(0,deepLines[5].length-1)];}
      }
      // shelter tip if talking to Dee
      if(npc.id==="dee"&&npcRep>=3){
        const hotTip=["The Bronx shelter has eight empty beds tonight. Word.",
          "Rico's been quiet in Queens. Good time to move product if you need to.",
          "There's a free meal at St. Anthony's at 6pm. Bring whoever you know.",
          "The Captain was spotted uptown two nights ago. Haven't heard since.",
          `Cops ran a sweep on ${getBoro(boro)?.name} last night. Should be quiet today.`];
        push(``,`${npc.icon} ${npc.name}:`,dialogueLine,``,`💡 ${hotTip[rnd(0,hotTip.length-1)]}`);
      } else {
        push(``,`${npc.icon} ${npc.name}:`,dialogueLine,``);
      }
      setNpcs(prev=>prev.map(n=>n.id===npc.id?{...n,rep:Math.min(n.rep+1,10)}:n));
      updGs(g=>{
        const newProg={...g.questProgress};
        Object.keys(g.activeQuests||{}).forEach(qid=>{
          const visited=newProg[qid]?.npcsVisited||[];
          if(!visited.includes(npc.id))newProg[qid]={...(newProg[qid]||{}),npcsVisited:[...visited,npc.id]};
        });
        return applyXP({...g,survival:{...g.survival,mental:clamp((g.survival.mental||70)+8,0,100)},questProgress:newProg},5,"talk");
      });
      push(`Mental +8. Rep with ${npc.name} up.`);return;}

    // DECLARE WAR [crew]
    const warM=C.match(/^DECLARE WAR (.+)$/);
    if(warM){
      if(!gs.crew){push("Not in a crew.");return;}
      if(gs.crewRole!=="leader"&&gs.crewRole!=="captain"){push("Only crew leaders can declare war.");return;}
      const wTarget=warM[1].trim();
      const myCrewD=world.crews?.[gs.crew]||{};
      if((myCrewD.wars||[]).includes(wTarget)){push("Already at war with "+wTarget+".");return;}
      const upCrew={...myCrewD,wars:[...(myCrewD.wars||[]),wTarget]};
      const wws={...world,crews:{...(world.crews||{}),[gs.crew]:upCrew}};
      const wws2=broadcastActivity(wws,gs.crew+" DECLARED WAR on "+wTarget+". Corners contested.","⚔");
      const wws3=notifyPlayers(wws2,gs.name,"⚔ "+gs.crew+" declared war on "+wTarget+". Watch your corners.");
      setWorld(wws3);saveWorld(wws3);
      push("⚔ WAR DECLARED on "+wTarget+".","2x XP on "+wTarget+" members.","Contested corners give double rep.","PEACE "+wTarget+" to end it.");return;
    }
    // PEACE [crew]
    const peaceM=C.match(/^PEACE (.+)$/);
    if(peaceM){
      if(!gs.crew){push("Not in a crew.");return;}
      const pTarget=peaceM[1].trim();
      const myCrewD2=world.crews?.[gs.crew]||{};
      const upCrew2={...myCrewD2,wars:(myCrewD2.wars||[]).filter(w=>w!==pTarget)};
      const pws={...world,crews:{...(world.crews||{}),[gs.crew]:upCrew2}};
      const pws2=broadcastActivity(pws,gs.crew+" called peace with "+pTarget+". War over.","🤝");
      setWorld(pws2);saveWorld(pws2);
      push("🤝 Peace called with "+pTarget+".");return;
    }
    // WAR STATUS
    if(C==="WAR STATUS"||C==="WARS"){
      const myW=world.crews?.[gs.crew]||{};
      const wars=myW.wars||[];
      push("⚔ "+(gs.crew||"No crew")+" — WARS",wars.length?"At war: "+wars.join(", "):"No active wars.","DECLARE WAR [crew] to start one.");return;
    }
    // MSG
    const msgM=raw.match(/^[Mm][Ss][Gg] (.+)$/);
    if(msgM){const entry={from:gs.name,text:msgM[1],time:Date.now(),boro};
      const ws={...world,messages:[...(world.messages||[]).slice(-49),entry]};setWorld(ws);saveWorld(ws);setWMsgs(ws.messages);
      push(`📡 [${gs.name}]: ${msgM[1]}`);return;}

    // SLEEP — weather changes next day
    if(C==="SLEEP"){
      // Captain spawn — appears when world total heat is high
      const worldHeat=Object.values(world.players||{}).reduce((s,p)=>s+(p.heat||0),0);
      if(worldHeat>30&&(!world.captainBoro||world.captainDay!==gs.day)){
        const capBoro=BOROUGHS[rnd(0,BOROUGHS.length-1)].id;
        const capWs={...world,captainBoro:capBoro,captainDay:gs.day+1};
        const capWs2=notifyPlayers(capWs,gs.name,`🚔 THE CAPTAIN has been spotted in ${getBoro(capBoro)?.name}. Heat is out of control.`);
        setWorld(capWs2);saveWorld(capWs2);setWMsgs(capWs2.messages||[]);
      }
      // Update supply drought counters
      const newSupply={...world.supply};
      BOROUGHS.forEach(b=>Object.keys(PRODUCTS).forEach(pKey=>{
        const key=`${b.id}_${pKey}`;const droughtKey=`${b.id}_${pKey}_drought`;
        if(!newSupply[key]||newSupply[key]===0){newSupply[droughtKey]=(newSupply[droughtKey]||0)+1;}
        else{newSupply[droughtKey]=0;newSupply[key]=0;} // reset daily supply count
      }));
      setWorld(prev=>({...prev,supply:newSupply}));
      // debt penalty if not paid
      if(gs.debtOwed>0&&gs.debtOwed>0){
        const debtNpc=npcs.find(n=>n.b===boro);
        if(debtNpc)setNpcs(prev=>prev.map(n=>n.id===debtNpc.id?{...n,rep:Math.max(0,n.rep-1)}:n));
        push(`⚠ Debt unpaid: $${gs.debtOwed}. Rep hit with local contacts.`);
      }
      // check for expired quests
      const expiredQuests=Object.entries(gs.activeQuests||{}).filter(([qid,q])=>gs.day>=(q.startDay||0)+(q.duration||3));
      if(expiredQuests.length>0){
        expiredQuests.forEach(([qid,q])=>{
          push(`⚠ Quest FAILED: "${q.title}" — ran out of time.`);
          const npc2=npcs.find(n=>n.id===q.npc);
          if(npc2)setNpcs(prev=>prev.map(n=>n.id===q.npc?{...n,rep:Math.max(0,n.rep-1)}:n));
          journalEvent('questFail',q.title);
        });
        updGs(g=>{const na={...g.activeQuests};expiredQuests.forEach(([qid])=>delete na[qid]);return{...g,activeQuests:na};});
      }
      const income=gs.cornersOwned.reduce((s)=>s+rnd(20,50),0);
      const thrallIncome=(gs.thralls||[]).length*30;
      const networkIncome=gs.isFixer&&hasSkill(gs,"network_effect")?Object.keys(world.players||{}).length*5:0;
      // reset rat daily infos
      if(gs.isRat)updGs(g=>({...g,informsToday:0}));
      // mark as away during sleep
      const sleepWs={...world,players:{...(world.players||{}),[gs.name]:{...(world.players||{})[gs.name],lastSeen:Date.now()-200000}}};
      setWorld(sleepWs);saveWorld(sleepWs);
      const nightIncome=gs.isVampire&&hasSkill(gs,"ancient_blood")?rnd(30,80):0;
      const crewBonus=gs.crew&&world.crews?.[gs.crew]?rnd(5,15):0;
      const safePassive=Object.entries(world.safehouses||{}).filter(([,s])=>s.owner===gs.name||(gs.crew&&s.crewOwner===gs.crew)).length*rnd(5,10);
      const nextDay=gs.day+1;const nextWeather=getWeather(nextDay);
      // junkie habit cost
      let habitCost=0;let habitMsg="";
      if(gs.isJunkie){
        habitCost=20;
        if(gs.cash>=habitCost){habitMsg=`Habit: -$${habitCost}.`;}
        else{habitMsg=`Couldn't cover habit. Health dropping.`;}
      }
      // undocumented community network passive income
      const commBonus=gs.isUndoc?rnd(5,20):0;
      updGs(g=>{
        const habHealth=g.isJunkie&&g.cash<habitCost?clamp(g.survival.health-15,0,100):g.survival.health+5;
        const newAddiction=Math.max(0,(g.addiction||0)-1);
        const _oldLvl=getAddictionLevel(g.addiction||0);
        const _newLvl=getAddictionLevel(newAddiction);
        if(_newLvl.name!==_oldLvl.name&&newAddiction<(g.addiction||0)){
          setTimeout(()=>push(`${CLASS_SUBSTANCE[g.archetype?.id||'veteran']?.icon} Addiction easing: ${_oldLvl.name} → ${_newLvl.name} (${newAddiction}/100)`),300);
        }
        return{...g,day:nextDay,addiction:newAddiction,hustleCount:0,hustleBoroLast:"",hustleBoros:{},
          cash:g.cash-habitCost+income+crewBonus+safePassive+commBonus,
          survival:{hunger:clamp(g.survival.hunger-20,0,100),warmth:clamp(g.survival.warmth-10,0,100),health:clamp(habHealth,0,100),energy:95},
          heat:clamp(g.heat-2,0,10),habitPaid:g.cash>=habitCost,
          hustleCount:0,hustleBoroLast:"",hustleBoros:{},
        dayJobDone:false,hasMetrocard:false,panhandleCount:0,
        dayJobDone:false,hasMetrocard:false,

          informsToday:0,patrolEncountered:false,feedUsed:false};
      });
      // reset shelter checkins for new day
      const ws2={...world,shelterCheckins:{}};setWorld(ws2);saveWorld(ws2);
      // generate newspaper for new day
      const paper=generateNewspaper(gs,world);
      setNewspaper(paper);

      const dayTransitions=[
        `You close your eyes somewhere between midnight and dawn. The city doesn't stop for you. It never does.`,
        `Sleep comes eventually. Heavy and dreamless, the way it comes when the body is done arguing.`,
        `You find a spot. Not comfortable. Functional. Your eyes close before you finish the thought.`,
        `The night passes the way nights pass out here — slowly, then all at once.`,
      ];
      setGameTime({hour:8,minute:0});
      const sleepActWs=broadcastActivity(world,`${gs.name} called it a night. Day ${gs.day} done.`,"🌙");
      setWorld(prev=>({...prev,...sleepActWs}));
      push(
        ``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        dayTransitions[rnd(0,dayTransitions.length-1)],
        ``,
        `DAY ${nextDay}  ·  THE STREET REPORT`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ...paper.headlines.map(h=>`  ${h}`),
        ``,
        paper.personal,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `${income>0?`Corners earned you $${income} while you slept. `:""}`+
        `${crewBonus>0?`Crew added $${crewBonus}. `:""}`+
        `${safePassive>0?`Safe houses: +$${safePassive}. `:""}`+
        `${commBonus>0?`Community network: +$${commBonus}. `:""}`+
        `${thrallIncome>0?`Thralls: +$${thrallIncome}. `:""}`+
        `${nightIncome>0?`Night economy: +$${nightIncome}. `:""}`+
        `${networkIncome>0?`Network cut: +$${networkIncome}.`:""}`,
        habitMsg||"",
        `${nextWeather.icon} ${nextWeather.name} today — ${nextWeather.desc}`,
        ``,
      );return;
    }

    // SCORE — junkie unique command (find product at street price)
    if(C==="SCORE"){
      if(!gs.isJunkie){push(`That's not your world.`);return;}
      const cost=rnd(8,15);
      if(gs.cash<cost){push(`Can't score. Need at least $${cost}.`);return;}
      // scoring gives a small hit of weed at deep discount, but raises heat slightly
      updGs(g=>applyXP({...g,cash:g.cash-cost,product:{...g.product,weed:g.product.weed+1},heat:clamp(g.heat+0.5,0,10),survival:{...g.survival,energy:clamp(g.survival.energy+20,0,100)}},3,"deal"));
      push(`You know where to go when you need it.`,`$${cost}. One bag. Nobody saw anything.`,`Energy up. Heat barely moved.`);return;
    }

    // CONNECT — undocumented unique command (tap community network)
    if(C==="CONNECT"){
      if(!gs.isUndoc){push(`You don't have those connections.`);return;}
      const options=["A contact slips you a lead on cheap product. +$15.",`Someone in the network spots a cop pattern. Heat -.5 for the next hour.`,`Community meal tonight. Hunger restored.`,`A cousin knows a corner that's been empty for days. CLAIM it free.`];
      const result=options[rnd(0,options.length-1)];
      if(result.includes("Hunger")){
        updGs(g=>applyXP({...g,survival:{...g.survival,hunger:clamp(g.survival.hunger+40,0,100)}},5,"talk"));
      } else if(result.includes("Heat")){
        updGs(g=>applyXP({...g,heat:clamp(g.heat-1,0,10)},5,"scout"));
      } else if(result.includes("$15")){
        updGs(g=>applyXP({...g,cash:g.cash+15},5,"hustle"));
      } else {
        updGs(g=>applyXP(g,10,"scout"));
      }
      push(`You reach out through the network.`,result);return;
    }

    // VANISH — undocumented emergency heat dump
    if(C==="VANISH"){
      if(!gs.isUndoc){push(`You don't know how to disappear like that.`);return;}
      if(gs.heat<4){push(`Heat's already low. Save it for when you need it.`);return;}
      updGs(g=>({...g,heat:clamp(g.heat-3,0,10),ghostMode:g.heat>=9,survival:{...g.survival,energy:clamp(g.survival.energy-20,0,100)}}));
      push(`You fold into the community. A dozen people don't know your name but cover for you anyway.`,`Heat drops 3. You're invisible.`);return;
    }

    // FLIP — hustler unique command (fast market arbitrage between boroughs)
    if(C==="FLIP"){
      if(!gs.isHustler){push(`You don't think that way.`);return;}
      // compare current borough prices to all others
      const current=Object.entries(PRODUCTS).map(([key,p])=>({key,buy:Math.round(mktPrice(boro,key,gs.day,weather)*p.bm),sell:mktPrice(boro,key,gs.day,weather)}));
      push(`💵 FLIP ANALYSIS — ${getBoro(boro)?.short}:`,...current.map(p=>`  ${PRODUCTS[p.key].icon} ${PRODUCTS[p.key].name}: Buy $${p.buy} → Sell $${p.sell} (margin $${p.sell-p.buy})`),`Best margins: move to high-opp boroughs to sell.`);
      return;
    }

    // WORK — show available day labor jobs
    if(C==="WORK"){
      const todayJobs=DAY_LABOR_JOBS.filter(j=>!j.location||j.location===boro||Math.random()<0.5);
      if(!todayJobs.length){push(`No day work available here today. Try another borough.`);return;}
      push(``,`💼 DAY LABOR — ${getBoro(boro)?.name}`,`Cash jobs, no ID required.`,``,...todayJobs.map(j=>{
        const bonus=j.classBonus?.[gs.archetype?.id]||0;
        const pay=`$${j.pay[0]+bonus}-$${j.pay[1]+bonus}`;
        return `  ${j.name} · ${pay} · ${j.energy} energy · TAKE [${j.id}]`;
      }),``,`Type TAKE [job] to take a shift.`);
      return;
    }

    // TAKE [job] — take a day labor job
    const takeM=C.match(/^TAKE (.+)$/);
    if(takeM){
      const jobId=takeM[1].toLowerCase().replace(/ /g,"_");
      const job=DAY_LABOR_JOBS.find(j=>j.id===jobId||j.name.toLowerCase().includes(takeM[1].toLowerCase()));
      if(!job){push(`Unknown job. Type WORK to see what's available.`);return;}
      if(gs.dayJobDone){push(`You've already worked today. Rest and come back tomorrow.`);return;}
      if(gs.survival.energy<job.energy-10){push(`Too tired for a full shift. REST first.`);return;}
      // stat check if required
      if(job.statCheck){
        const roll20=roll(20);const statVal=gs.stats?.[job.statCheck.stat]||5;
        const total=roll20+Math.floor(statVal/2);
        if(total<job.statCheck.dc){
          push(`You tried to take the ${job.name} shift.`,`${job.statCheck.stat.toUpperCase()} check: d20=${roll20}+${Math.floor(statVal/2)}=${total} vs DC${job.statCheck.dc}`,`Didn't work out. Too rough today.`);
          updGs(g=>({...g,survival:{...g.survival,energy:clamp(g.survival.energy-15,0,100)},dayJobDone:true}));return;
        }
      }
      // pay
      const bonus=job.classBonus?.[gs.archetype?.id]||0;
      const base=rnd(job.pay[0],job.pay[1]);
      const pay=Math.max(20,base+bonus);
      const flavor=job.flavor[rnd(0,job.flavor.length-1)];
      // roll for fail
      if(Math.random()<(job.failChance||0)){
        push(`You showed up for the ${job.name} shift.`,`Didn't work out — wrong time, wrong place.`,`You head back. $0. Day's energy gone.`);
        updGs(g=>({...g,survival:{...g.survival,energy:clamp(g.survival.energy-job.energy,0,100)},dayJobDone:true}));return;
      }
      push(``,`💼 ${job.name}`,flavor,``,`Day's work done. +$${pay}. Energy -${job.energy}.`);
      if(job.heat<0)push(`Heat -1. Legitimate work has its advantages.`);
      updGs(g=>applyXP({...g,
        cash:g.cash+pay,
        heat:clamp(g.heat+(job.heat||0),0,10),
        dayJobDone:true,
        survival:{...g.survival,
          energy:clamp(g.survival.energy-job.energy,0,100),
          hunger:clamp(g.survival.hunger-15,0,100), // hard work makes you hungry
        },
      },15,"hustle"));
      return;
    }

    // PANHANDLE
    if(C==="PANHANDLE"){
      if(gs.isUndoc){push(`Too risky. You can't draw that kind of attention.`);return;}
      // Daily limit — diminishing returns
      const panToday=gs.panhandleCount||0;
      if(panToday>=4){push(`You've been on this corner too long. People stopped looking. Come back tomorrow.`);return;}
      if(gs.survival.energy<15){push(`Too exhausted to hold your hand out properly.`);return;}
      const base=PANHANDLE_BASE[boro]||5;
      const dogBonus=gs.isDrifter?base:0; // dog doubles the base yield
      const charmBonus=Math.floor((gs.stats.charm||5)/3);
      const weatherBonus=weather.id==="rain"||weather.id==="storm"?2:weather.id==="heatwave"?-3:0;
      const repeatPenalty=panToday*2;
      const maxEarned=Math.max(1,base+dogBonus+charmBonus+weatherBonus-repeatPenalty);
      const success=Math.random()>(0.25+panToday*0.1);
      if(success){
        const earned=rnd(Math.max(1,maxEarned-3),maxEarned);
        const mentalCost=gs.isDrifter?3:rnd(5,12); // dog helps mental
        const energyCost=rnd(5,10);
        const panMsg=gs.isDrifter?
          ["A woman stops for the dog first. You second. She gives $"+earned+". The dog gets a pet.",
           "The dog sits. Looks up with those eyes. Three people stop. You end up with $"+earned+".",
           "Guy in a suit walks past three times before the dog gets him. $"+earned+"."][rnd(0,2)]:
          PANHANDLE_MSGS[rnd(0,PANHANDLE_MSGS.length-1)];
        updGs(g=>applyXP({...g,cash:g.cash+earned,panhandleCount:(g.panhandleCount||0)+1,
          survival:{...g.survival,mental:clamp((g.survival.mental||70)-mentalCost,0,100),energy:clamp(g.survival.energy-energyCost,0,100)}},gs.isDrifter?3:2,"hustle"));
        push(panMsg,`+$${earned}. Mental -${mentalCost}. Energy -${energyCost}.`,panToday>=2?`People are recognizing you. Returns dropping.`:"");
      } else {
        updGs(g=>({...g,panhandleCount:(g.panhandleCount||0)+1,survival:{...g.survival,mental:clamp((g.survival.mental||70)-15,0,100),energy:clamp(g.survival.energy-8,0,100)}}));
        push(PANHANDLE_FAIL[rnd(0,PANHANDLE_FAIL.length-1)]);
      }
      return;
    }

    // SHELTER — check in or view
    if(C==="SHELTER"){
      const s=SHELTERS[boro];
      if(!s){push(`No shelter in ${getBoro(boro)?.name}.`);return;}
      if(gs.isUndoc){push(`You can't sign in. No ID, no bed. That's the rule.`,`Try CONNECT for community alternatives.`);return;}
      const beds=shelterBeds(boro,gs.day);
      const checkins=world.shelterCheckins?.[boro]||0;
      push(`${s.name}`,`Beds: ${Math.max(0,beds-checkins)}/${beds} available`,`Curfew: ${s.curfew}:00`,`Rules: ${s.rules.join(" · ")}`,``,`Type CHECKIN to secure a bed.`);
      return;
    }

    // CHECKIN — secure a shelter bed
    if(C==="CHECKIN"){
      if(gs.isDrifter){push(`${gs.dogName||"Your dog"} is not allowed inside. No exceptions. You find somewhere else.`);return;}
      if(gs.isUndoc){push(`Can't check in without ID.`);return;}
      const s=SHELTERS[boro];if(!s){push(`No shelter here.`);return;}
      const beds=shelterBeds(boro,gs.day);
      const checkins=world.shelterCheckins?.[boro]||0;
      if(checkins>=beds){push(`${s.name} is full tonight. ${weather.id==="blizzard"?"City should open overflow — try another borough.":"Try another borough."}`);return;}
      // check if carrying product (no product rule)
      const hasProduct=Object.values(gs.product).some(v=>v>0)||Object.values(gs.cooked||{}).some(v=>v>0);
      if(hasProduct){push(`Can't check in holding product. STASH it first or skip the shelter.`);return;}
      // register checkin in world
      const ws={...world,shelterCheckins:{...(world.shelterCheckins||{}),[boro]:(world.shelterCheckins?.[boro]||0)+1}};
      setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,
        survival:{...g.survival,
          hunger:clamp(g.survival.hunger+15,0,100),
          warmth:100,health:clamp(g.survival.health+15,0,100),
          energy:100,mental:clamp((g.survival.mental||70)+20,0,100)},
        heat:clamp(g.heat-1,0,10),
        shelterCheckins:{...(g.shelterCheckins||{}),[boro]:(g.shelterCheckins?.[boro]||0)+1},
      }));
      push(`You sign in at ${s.name}.`,`A real bed. Warm. Safe.`,`Hunger eased. Warmth restored. Mental health up.`,`You sleep better than you have in weeks.`);journalEvent("shelter",s.name);
      return;
    }

    // SHELTERS — list all
    if(C==="SHELTERS"){
      push(`NYC Shelters tonight ${weather.id==="blizzard"?"(WINTER OVERFLOW ACTIVE)":""}:`,...BOROUGHS.map(b=>{
        const s=SHELTERS[b.id];if(!s)return null;
        const beds=shelterBeds(b.id,gs.day);const taken=world.shelterCheckins?.[b.id]||0;
        return `  ${b.short} ${s.name}: ${Math.max(0,beds-taken)}/${beds} beds · curfew ${s.curfew}:00`;
      }).filter(Boolean));
      return;
    }

    // SEARCH — scavenge for found objects
    if(C==="SEARCH"){
      const now=gs.day;
      if(gs.lastSearch===now){push(`You already searched today. Come back tomorrow.`);return;}
      const find=SEARCH_FINDS[rnd(0,SEARCH_FINDS.length-1)];
      const mentalBoost=find.type==="nothing"?-3:5;
      // update quest progress
      updGs(g=>{
        const newProg={...g.questProgress};
        Object.keys(g.activeQuests||{}).forEach(qid=>{
          newProg[qid]={...(newProg[qid]||{}),searches:(newProg[qid]?.searches||0)+1};
        });
        return{...g,questProgress:newProg};
      });
      // quest item finds
      if(find.type==="questitem"){
        const boroOk=!find.boroOnly||find.boroOnly===boro;
        if(boroOk&&Math.random()<(find.prob||0.1)){
          if(!gs.inventory.includes(find.item)){
            updGs(g=>({...g,inventory:[...g.inventory,find.item]}));
            push(`${find.desc}`,`Found: ${find.item}`);
            return;
          }
        }
      }
      if(find.type==="cash"){
        const amt=rnd(find.value[0],find.value[1]);
        updGs(g=>applyXP({...g,cash:g.cash+amt,lastSearch:now,survival:{...g.survival,mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},6,"scout"));
        push(`You search the area.`,find.desc.replace("%v",amt),`+$${amt}.`);
      } else if(find.type==="food"){
        const hunger=rnd(find.value[0],find.value[1]);
        updGs(g=>applyXP({...g,lastSearch:now,survival:{...g.survival,hunger:clamp(g.survival.hunger+hunger,0,100),mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},6,"scout"));
        push(`You search the area.`,find.desc,`Hunger +${hunger}.`);
      } else if(find.type==="warmth"){
        const warmth=rnd(find.value[0],find.value[1]);
        updGs(g=>applyXP({...g,lastSearch:now,survival:{...g.survival,warmth:clamp(g.survival.warmth+warmth,0,100),mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},6,"scout"));
        push(`You search the area.`,find.desc,`Warmth +${warmth}.`);
      } else if(find.type==="gear"){
        updGs(g=>applyXP({...g,lastSearch:now,inventory:[...g.inventory,find.item],survival:{...g.survival,mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},8,"scout"));
        push(`You search the area.`,find.desc,`Added to inventory: ${find.item}.`);
      } else if(find.type==="product"){
        updGs(g=>applyXP({...g,lastSearch:now,product:{...g.product,[find.product]:g.product[find.product]+find.qty},survival:{...g.survival,mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},8,"scout"));
        push(`You search the area.`,find.desc,`+${find.qty} ${find.product}.`);
      } else {
        updGs(g=>({...g,lastSearch:now,survival:{...g.survival,mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}}));
        push(`You search the area.`,find.desc);
      }
      return;
    }

    // WRITE — letter home / inner life log
    if(C==="WRITE"){
      push(`What do you want to write? Type your message then hit ENTER.`,`It goes into the world log. Other players can READ LETTERS.`,`Usage: WRITE [your message]`);
      return;
    }
    const writeM=raw.match(/^[Ww][Rr][Ii][Tt][Ee] (.+)$/);
    if(writeM&&writeM[1].length>3){
      const letter={from:gs.name,text:writeM[1],day:gs.day,boro,archetype:gs.archetype?.id,time:Date.now()};
      const ws={...world,letters:[...(world.letters||[]).slice(-29),letter]};
      setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,survival:{...g.survival,mental:clamp((g.survival.mental||70)+10,0,100)},letterWritten:true}));
      push(`You write it down.`,`"${writeM[1]}"`,`Mental health up. Some things need to be said.`);journalEvent("firstLetter");
      return;
    }

    // READ LETTERS — see what others wrote
    if(C==="READ LETTERS"){
      const letters=world.letters||[];
      if(!letters.length){push(`Nothing written yet. Be the first.`);return;}
      push(`— LETTERS FROM THE STREET —`,...letters.slice(-8).map(l=>`${l.from} · Day ${l.day} · ${getBoro(l.boro)?.short}: "${l.text}"`));
      updGs(g=>({...g,survival:{...g.survival,mental:clamp((g.survival.mental||70)+5,0,100)}}));
      return;
    }

    // CHOOSE [1/2] — respond to rare event
    const chooseM=C.match(/^CHOOSE ([12])$/);
    if(chooseM){
      if(!rareEvent){push(`Nothing to choose right now.`);return;}
      const idx=parseInt(chooseM[1])-1;
      const choice=rareEvent.choices[idx];
      if(!choice){push(`Invalid choice.`);return;}
      updGs(g=>choice.fn(g));
      push(``,choice.outcome,``);
      // log to world history
      const ws=addWorldHistory(world,"event",gs.name,`${gs.name} faced "${rareEvent.title}" — chose: ${choice.label}`,boro);
      const ws2=notifyPlayers(ws,gs.name,`⚡ ${gs.name} just faced "${rareEvent.title}" on the street.`);
      setWorld(ws2);saveWorld(ws2);setWMsgs(ws2.messages||[]);
      setRareEvent(null);return;
    }

    // RETIRE — prestige system
    if(C==="RETIRE"){
      if(gs.level<PRESTIGE_LEVEL){push(`Need Level ${PRESTIGE_LEVEL} to retire. You're Level ${gs.level}.`);return;}
      const pLvl=Math.min((gs.prestige||0)+1,PRESTIGE_BADGES.length-1);
      const buff=PRESTIGE_BUFFS[(gs.prestige||0)%PRESTIGE_BUFFS.length];
      const badge=PRESTIGE_BADGES[pLvl-1];
      // write permanent legacy to world
      const legacy={name:gs.name,prestige:pLvl,badge,day:gs.day,cornersEver:gs.cornersOwned?.length||0,time:Date.now()};
      const ws=addWorldHistory(world,"prestige",gs.name,`${gs.name} retired at Level ${gs.level} (Day ${gs.day}). ${badge}`,boro);
      const ws2=notifyPlayers(ws,gs.name,`🏆 ${gs.name} just retired as a ${badge}. Respect.`);
      ws2.legends=[...(ws2.legends||[]).slice(-19),legacy];
      setWorld(ws2);saveWorld(ws2);setWMsgs(ws2.messages||[]);
      setPrestige(pLvl);
      // reset character but keep prestige buff
      push(``,`🏆 YOU RETIRED.`,`${badge}`,`Prestige ${pLvl}. ${buff.desc} carries to next life.`,`Your name is written on the streets permanently.`,`Refresh to start your next run with your legacy buff.`);
      return;
    }

    // HISTORY — world event log
    if(C==="HISTORY"){
      const hist=world.worldHistory||[];
      if(!hist.length){push(`Nothing recorded yet. History is made by those who survive long enough.`);return;}
      push(`— WORLD HISTORY —`,...hist.slice(-10).reverse().map(h=>`  [Day ${h.day}] ${h.actor}: ${h.detail}`));
      return;
    }

    // LEGENDS — prestige hall of fame
    if(C==="LEGENDS"){
      const legs=world.legends||[];
      if(!legs.length){push(`No legends yet. Be the first to retire.`);return;}
      push(`— LEGENDS OF THE STREET —`,...legs.slice(-8).reverse().map(l=>`  ${l.badge} ${l.name} · Prestige ${l.prestige} · Day ${l.day}`));
      return;
    }

    // NOTIFY — check notifications
    if(C==="NOTIFY"||C==="NOTIFICATIONS"){
      const notifs=(world.notifications||[]).filter(n=>n.to===gs.name);
      if(!notifs.length){push(`No notifications.`);return;}
      push(`Notifications:`,...notifs.slice(-5).map(n=>n.msg));
      return;
    }

    // SKILLS — view skill tree
    if(C==="SKILLS"){
      const tree=SKILL_TREES[gs.archetype?.id]||[];
      push(`— ${gs.archetype?.name} SKILL TREE — (${gs.skillPoints||0} points available)`,...tree.map(s=>{
        const owned=(gs.skills||[]).includes(s.id);
        const canAfford=(gs.skillPoints||0)>=s.cost;
        const prereqLevel=gs.level>=s.level;
        const status=owned?"✓ LEARNED":!prereqLevel?`[Req Lvl ${s.level}]`:!canAfford?`[Need ${s.cost}pt]`:"[AVAILABLE]";
        return `  ${owned?"🟢":"⚪"} ${s.name} ${status} — ${s.desc}`;
      }),``,`Type UNLOCK [skill name] to learn.`);
      return;
    }

    // UNLOCK [skill] — spend skill point
    const unlockM=C.match(/^UNLOCK (.+)$/);
    if(unlockM){
      const sName=raw.slice(7).trim().toLowerCase();
      const tree=SKILL_TREES[gs.archetype?.id]||[];
      const skill=tree.find(s=>s.name.toLowerCase()===sName||s.id===sName.replace(/ /g,"_"));
      if(!skill){push(`Unknown skill. Type SKILLS to see your tree.`);return;}
      if((gs.skills||[]).includes(skill.id)){push(`Already learned: ${skill.name}.`);return;}
      if(gs.level<skill.level){push(`Need Level ${skill.level}. You're Level ${gs.level}.`);return;}
      if((gs.skillPoints||0)<skill.cost){push(`Need ${skill.cost} skill point(s). Have ${gs.skillPoints||0}.`);return;}
      updGs(g=>({...g,skills:[...(g.skills||[]),skill.id],skillPoints:(g.skillPoints||0)-skill.cost}));
      push(`✓ Learned: ${skill.name}`,skill.desc);
      return;
    }

    // GEAR — show equipment
    if(C==="GEAR"){
      const eqStats=getItemStats(gs.equipment);
      push(`— EQUIPMENT —`,...EQUIPMENT_SLOTS.map(slot=>{
        const itemId=gs.equipment?.[slot];
        const item=itemId?getItemById(itemId):null;
        const rar=item?ITEM_RARITY[item.rarity]:null;
        return `  ${slot.toUpperCase()}: ${item?`${rar?.prefix||""}${item.name} [${Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(", ")}]`:"(empty)"}`;
      }),``,`Stat bonuses: ${Object.entries(eqStats).map(([k,v])=>`${k}+${v}`).join(", ")||"none"}`);
      return;
    }

    // EQUIP [item name] — equip an item from inventory
    const equipM=C.match(/^EQUIP (.+)$/);
    if(equipM){
      const iName=raw.slice(6).trim().toLowerCase();
      const item=BASE_ITEMS.find(i=>i.name.toLowerCase()===iName||i.id===iName.replace(/ /g,"_"));
      if(!item){push(`Don't know that item.`);return;}
      if(!gs.inventory.includes(item.name)&&!gs.inventory.includes(item.id)){push(`Don't have ${item.name}.`);return;}
      const oldItem=gs.equipment?.[item.slot];
      const newInv=gs.inventory.filter(i=>i!==item.name&&i!==item.id);
      if(oldItem){const old=getItemById(oldItem);if(old)newInv.push(old.name);}
      updGs(g=>({...g,equipment:{...g.equipment,[item.slot]:item.id},inventory:newInv}));
      push(`Equipped: ${ITEM_RARITY[item.rarity].prefix}${item.name} (${item.slot})`,`Stats: ${Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(", ")}`);
      return;
    }

    // UNEQUIP [slot] — remove equipped item
    const unequipM=C.match(/^UNEQUIP (\w+)$/);
    if(unequipM){
      const slot=unequipM[1].toLowerCase();
      if(!EQUIPMENT_SLOTS.includes(slot)){push(`Slots: ${EQUIPMENT_SLOTS.join(", ")}`);return;}
      const itemId=gs.equipment?.[slot];
      if(!itemId){push(`Nothing equipped in ${slot}.`);return;}
      const item=getItemById(itemId);
      updGs(g=>({...g,equipment:{...g.equipment,[slot]:null},inventory:item?[...g.inventory,item.name]:g.inventory}));
      push(`Unequipped ${item?.name||slot}.`);return;
    }

    // LOOT — show available items to find/buy (from search or black market)
    if(C==="LOOT"){
      // 3 random items available in current borough today
      const seed=(gs.day+boro.length)%BASE_ITEMS.length;
      const available=[BASE_ITEMS[seed%BASE_ITEMS.length],BASE_ITEMS[(seed+7)%BASE_ITEMS.length],BASE_ITEMS[(seed+13)%BASE_ITEMS.length]];
      const prices={common:50,uncommon:150,rare:400,legendary:1200};
      push(`— BLACK MARKET (${getBoro(boro)?.short}) —`,...available.map(item=>{
        const rar=ITEM_RARITY[item.rarity];
        const price=prices[item.rarity];
        return `  ${rar.prefix}${item.name} [${item.slot}] $${price} — ${Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(", ")}`;
      }),``,`Type BUY ITEM [name] to purchase.`);
      return;
    }

    // BUY ITEM [name] — buy gear from black market
    const buyItemM=C.match(/^BUY ITEM (.+)$/);
    if(buyItemM){
      const iName=raw.slice(9).trim().toLowerCase();
      const item=BASE_ITEMS.find(i=>i.name.toLowerCase()===iName||i.id===iName.replace(/ /g,"_"));
      if(!item){push(`Unknown item. Type LOOT to see what's available.`);return;}
      const prices={common:50,uncommon:150,rare:400,legendary:1200};
      const price=prices[item.rarity];
      if(gs.cash<price){push(`Need $${price}. Have $${gs.cash}.`);return;}
      updGs(g=>({...g,cash:g.cash-price,inventory:[...g.inventory,item.name]}));
      push(`Acquired: ${ITEM_RARITY[item.rarity].prefix}${item.name} for $${price}.`,`Type EQUIP ${item.name.toLowerCase()} to wear it.`);
      return;
    }

    // Skill-based abilities
    // INTIMIDATE
    if(C==="INTIMIDATE"){
      if(!hasSkill(gs,"intimidate")){push(`Don't have that skill. Check SKILLS.`);return;}
      updGs(g=>({...g,intimidateActive:true,survival:{...g.survival,energy:clamp(g.survival.energy-15,0,100)}}));
      push(`You step forward. Eyes dead. Nobody moves.`,`Next fight: target's power reduced 20%.`);return;
    }
    // SHADOW
    const shadowM=C.match(/^SHADOW (.+)$/);
    if(shadowM){
      if(!hasSkill(gs,"shadow_step")){push(`Don't have that skill.`);return;}
      const t=BOROUGHS.find(bx=>bx.name.toLowerCase().includes(shadowM[1].toLowerCase())||bx.id===shadowM[1].toLowerCase());
      if(!t){push(`Unknown borough.`);return;}
      setBoro(t.id);
      push(`You move through the city like you were never there.`,`Arrived in ${t.name}. Zero heat cost.`);
      updGs(g=>applyXP({...g,survival:{...g.survival,energy:clamp(g.survival.energy-10,0,100)}},8,"move"));
      return;
    }
    // BLUFF
    if(C==="BLUFF"){
      if(!hasSkill(gs,"bluff")){push(`Don't have that skill.`);return;}
      if(gs.bluffUsed===gs.day){push(`Already used today.`);return;}
      const pKey=Object.keys(gs.product).find(k=>gs.product[k]>0);
      if(!pKey){push(`Nothing to bluff with.`);return;}
      const price=Math.round(mktPrice(boro,pKey,gs.day,weather)*1.5);
      updGs(g=>({...g,cash:g.cash+price,product:{...g.product,[pKey]:g.product[pKey]-1},bluffUsed:gs.day}));
      push(`You talk it up. They believe every word.`,`Sold 1 ${pKey} at 1.5x rate. +$${price}.`);return;
    }
    // LAUNDER
    if(C==="LAUNDER"){
      if(!hasSkill(gs,"money_launder")){push(`Don't have that skill.`);return;}
      if(gs.cash<100){push(`Need $100 to launder.`);return;}
      updGs(g=>({...g,cash:g.cash-100,heat:clamp(g.heat-2,0,10)}));
      push(`Money moved through three shells. Heat -2.`);return;
    }
    // QUIT (junkie)
    if(C==="QUIT"){
      if(!hasSkill(gs,"redemption")){push(`You need the Redemption skill first.`);return;}
      if(!gs.isJunkie){push(`This isn't your path.`);return;}
      updGs(g=>({...g,isJunkie:false,habitCost:0,
        stats:{hustle:Math.min(10,g.stats.hustle+1),streetiq:Math.min(10,g.stats.streetiq+1),toughness:Math.min(10,g.stats.toughness+1),charm:Math.min(10,g.stats.charm+1),heat:g.stats.heat},
        survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+30)}}));
      push(``,`You quit.`,`It doesn't happen overnight. But you quit.`,`All stats +1. Mental +30. No more habit.`,``);return;
    }
    // PICKPOCKET
    if(C==="PICKPOCKET"){
      if(!hasSkill(gs,"pickpocket")){push(`Don't have that skill.`);return;}
      const others2=Object.entries(world.players||{}).filter(([n,d])=>n!==gs.name&&d.borough===boro);
      if(!others2.length){push(`Nobody to pickpocket here.`);return;}
      const stolen2=rnd(5,20);
      updGs(g=>applyXP({...g,cash:g.cash+stolen2},10,"fight"));
      push(`Smooth. They didn't feel a thing. +$${stolen2}.`);return;
    }

    // USE — intentionally get high
    if(C==="USE"){
      if(gs.isVampire){push(`FEED is your equivalent.`);return;}
      if(gs.isUndoc){push(`You don't use. You survive.`);return;}
      const sub=CLASS_SUBSTANCE[gs.archetype?.id||"veteran"];
      const hasProd=sub?.product&&(gs.product[sub.product]||0)>0;
      const canBuy=sub?.buyCost>0&&gs.cash>=sub.buyCost;
      if(!hasProd&&!canBuy){push(`${sub?.icon} No ${sub?.name}. Running dry.`,`Addiction: ${getAddictionLevel(gs.addiction||0).name} (${gs.addiction||0}/100)`);return;}
      const hEvts=HIGH_EVENTS[sub.name]||HIGH_EVENTS.weed;
      const hEvt=hEvts[rnd(0,hEvts.length-1)];
      const addGain=rnd(3,8)+Math.floor((gs.addiction||0)/20);
      push("",`${sub.icon} You use.`,hEvt.msg,`Addiction now: ${Math.min(100,(gs.addiction||0)+addGain)}/100`,"");
      updGs(g=>{
        const eff=hEvt.effect||{};
        let ng={...g,lastUsed:g.day,withdrawalDay:0,highActive:true,addiction:Math.min(100,(g.addiction||0)+addGain)};
        if(sub.product&&hasProd)ng={...ng,product:{...ng.product,[sub.product]:Math.max(0,ng.product[sub.product]-1)}};
        else if(sub.buyCost)ng={...ng,cash:Math.max(0,ng.cash-sub.buyCost)};
        if(eff.cash)ng={...ng,cash:Math.max(0,ng.cash+eff.cash)};
        if(eff.health)ng={...ng,survival:{...ng.survival,health:clamp(ng.survival.health+eff.health,0,100)}};
        if(eff.mental)ng={...ng,survival:{...ng.survival,mental:clamp((ng.survival.mental||70)+eff.mental,0,100)}};
        if(eff.energy)ng={...ng,survival:{...ng.survival,energy:clamp(ng.survival.energy+(eff.energy||0),0,100)}};
        if(eff.heat)ng={...ng,heat:clamp(ng.heat+eff.heat,0,10)};
        return ng;
      });
      return;
    }

    // ADDICTION — check addiction status
    if(C==="ADDICTION"){
      if(gs.isVampire){push(`Your addiction is blood. THIRST shows that.`);return;}
      const sub=CLASS_SUBSTANCE[gs.archetype?.id||"veteran"];
      const lvl=getAddictionLevel(gs.addiction||0);
      const daysSince=gs.day-(gs.lastUsed||0);
      const withdrawThresh=Math.max(1,3-Math.floor((gs.addiction||0)/30));
      push(`${sub?.icon} ADDICTION — ${sub?.name}`,
        `Level: ${lvl.icon} ${lvl.name} (${gs.addiction||0}/100)`,
        lvl.desc,
        `Last used: Day ${gs.lastUsed||0} (${daysSince} day${daysSince!==1?"s":""} ago)`,
        `Withdrawal triggers after: ${withdrawThresh} day${withdrawThresh!==1?"s":""} clean`,
        daysSince>=withdrawThresh&&(gs.addiction||0)>20?"⚠ Currently in withdrawal.":"Clear for now.",
        "",
        "USE to intentionally use. Addiction grows with product handling.",
        "Recovery: -1 addiction per 2 days clean.");
      return;
    }

    // NEWSPAPER — read today's street report
    if(C==="NEWSPAPER"||C==="NEWS"||C==="PAPER"){
      if(!newspaper){
        push(`No paper yet. SLEEP to get tomorrow's edition.`);
        // generate one on demand
        const paper=generateNewspaper(gs,world);
        setNewspaper(paper);
        push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,`THE STREET REPORT — Day ${gs.day}`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,...paper.headlines.map(h=>`  ${h}`),``,paper.personal,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        return;
      }
      push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,`THE STREET REPORT — Day ${newspaper.day}`,`${newspaper.date}  ·  ${newspaper.weather.icon} ${newspaper.weather.name}`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,...newspaper.headlines.map(h=>`  ${h}`),``,newspaper.personal,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      return;
    }

    // PORTRAIT — show character portrait
    if(C==="PORTRAIT"){
      const arch2=gs.archetype?.id||"veteran";
      const frame=PORTRAIT_FRAMES[arch2]||PORTRAIT_FRAMES.veteran;
      const label=gs.name.slice(0,4).toUpperCase();
      const weapon=gs.equipment?.weapon?getItemById(gs.equipment.weapon):null;
      const chest=gs.equipment?.chest?getItemById(gs.equipment.chest):null;
      push(``,`— ${gs.name.toUpperCase()} —`,...frame.map(l=>l.replace("{}",label.padEnd(4).slice(0,4))),
        `HP: ${gs.survival.health}% · Mental: ${gs.survival.mental||70}%`,
        chest?`Wearing: ${chest.name}`:`No chest gear`,weapon?`Armed: ${weapon.name}`:`No weapon`,``);
      return;
    }

    // JOURNAL — read your character's history
    if(C==="JOURNAL"){
      const j=gs.journal||[];
      if(!j.length){push(`Journal is empty. Live a little.`);return;}
      push(`— ${gs.name}'s JOURNAL —`,...j.slice(-15).map(e=>`  ${e}`));
      return;
    }

    // BACKSTORY — view your character's backstory
    if(C==="BACKSTORY"){
      const bs=gs.backstory||{};
      const whyOpt=BACKSTORY_QUESTIONS[0].options.find(o=>o.id===bs.why);
      const leftOpt=BACKSTORY_QUESTIONS[1].options.find(o=>o.id===bs.left);
      const driveOpt=BACKSTORY_QUESTIONS[2].options.find(o=>o.id===bs.drive);
      push(`— ${gs.name}'s STORY —`,
        whyOpt?`Why: ${whyOpt.label}`:`Why: Unknown`,
        leftOpt?`Left behind: ${leftOpt.label}`:`Left behind: Unknown`,
        driveOpt?`Drive: ${driveOpt.label}`:`Drive: Unknown`,
        ``,
        whyOpt?.flavor||"",leftOpt?.flavor||"",driveOpt?.flavor||"");
      return;
    }

    // FEED — vampire feeds on NPC for health and cash
    if(C==="FEED"){
      if(!gs.isVampire){push(`That's not your nature.`);return;}
      if(gs.feedUsed){push(`You've fed today. Wait until tomorrow.`);return;}
      const feedHeal=hasSkill(gs,"blood_money")?30:15;
      const feedBonus=hasSkill(gs,"blood_money")?20:0;
      const ancientBlood=hasSkill(gs,"ancient_blood");
      const healAmt=ancientBlood?100:feedHeal; // full heal if ancient blood
      const cash=rnd(15,35)+feedBonus;
      updGs(g=>applyXP({...g,
        cash:g.cash+cash,
        feedUsed:true,
        feedCount:(g.feedCount||0)+1,
        survival:{...g.survival,
          health:clamp(g.survival.health+healAmt,0,100), // FEED heals, not sets
          warmth:clamp(g.survival.warmth+20,0,100),
        }},12,"fight"));
      const feedMsgs=[
        `You find someone alone near the overpass. They don't remember anything afterward.`,
        `A drunk stumbles out of the bar. You help them to a dark corner. They won't be calling anyone tonight.`,
        `The subway car empties out. You're alone with someone who shouldn't have been alone.`,
        `Quick. Quiet. They'll wake up confused but alive. Mostly.`,
      ];
      push(`🧛 ${feedMsgs[rnd(0,feedMsgs.length-1)]}`,`+$${cash}. Health +${healAmt}hp.${ancientBlood?" (Ancient Blood — full restore)":""}`);
      if(gs.survival.health>=95)push(`You're at full strength.`);
      return;
    }

    // MESMERIZE [npc] — vampire charm ability
    const mesM=C.match(/^MESMERIZE (.+)$/);
    if(mesM){
      if(!gs.isVampire){push(`You don't have that power.`);return;}
      if(!hasSkill(gs,"mesmerize")){push(`Unlock Mesmerize first. Type SKILLS.`);return;}
      const npcName=mesM[1].toLowerCase();
      const npc=npcs.find(n=>n.name.toLowerCase()===npcName||n.id===npcName);
      if(!npc){push(`Don't know ${mesM[1]}.`);return;}
      if(npc.b!==boro){push(`${npc.name} isn't here.`);return;}
      const outcomes=[
        {msg:`${npc.icon} ${npc.name}'s eyes go glassy. They hand you everything in their pocket.`, cash:rnd(20,50)},
        {msg:`${npc.icon} ${npc.name} whispers where the product stash is.`, intel:true},
        {msg:`${npc.icon} ${npc.name} tells you something they shouldn't. Heat -1.`, heatDown:true},
        {msg:`${npc.icon} ${npc.name} fights the pull. Charm too low. They shake it off.`, fail:true},
      ];
      const outcome=outcomes[gs.stats.charm>=8?rnd(0,2):rnd(0,3)];
      push(`👁 You fix your gaze on ${npc.name}.`,outcome.msg);
      if(outcome.cash)updGs(g=>applyXP({...g,cash:g.cash+outcome.cash},10,"talk"));
      else if(outcome.heatDown)updGs(g=>applyXP({...g,heat:clamp(g.heat-1,0,10)},10,"scout"));
      else updGs(g=>applyXP(g,5,"talk"));
      setNpcs(prev=>prev.map(n=>n.id===npc.id?{...n,rep:Math.min(n.rep+1,10)}:n));
      return;
    }

    // MIST [borough] — vampire movement ability
    const mistM=C.match(/^MIST (.+)$/);
    if(mistM){
      if(!gs.isVampire){push(`You can't do that.`);return;}
      if(!hasSkill(gs,"mist_form")){push(`Unlock Mist Form first.`);return;}
      const t=BOROUGHS.find(bx=>bx.name.toLowerCase().includes(mistM[1].toLowerCase())||bx.id===mistM[1].toLowerCase());
      if(!t){push(`Unknown borough.`);return;}
      setBoro(t.id);
      push(`🌫 You dissolve into vapor.`,`Drift through the city unseen.`,`Arrived in ${t.name}. No heat. No energy cost.`);
      updGs(g=>applyXP(g,10,"move"));
      const ws={...world,players:{...(world.players||{}),[gs.name]:{level:gs.level,borough:t.id,lastSeen:Date.now(),heat:Math.round(gs.heat)}}};
      setWorld(ws);saveWorld(ws);return;
    }

    // DOMINATE [player] — vampire force cash tribute
    const domM=C.match(/^DOMINATE (.+)$/);
    if(domM){
      if(!gs.isVampire){push(`That power isn't yours.`);return;}
      if(!hasSkill(gs,"domination")){push(`Unlock Domination first.`);return;}
      if(gs.dominateUsed===gs.day){push(`Already dominated someone today.`);return;}
      const tName=domM[1].trim();
      const tData=world.players?.[tName];
      if(!tData){push(`Don't know ${tName}.`);return;}
      if(tData.borough!==boro){push(`${tName} isn't here.`);return;}
      const tribute=50;
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`🧛 ${gs.name} dominated you. Lost $${tribute}. You felt compelled to comply.`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      updGs(g=>applyXP({...g,cash:g.cash+tribute,dominateUsed:gs.day},15,"fight"));
      push(`👁 You lock eyes with ${tName} across the block.`,`They reach into their pocket without knowing why.`,`+$${tribute}. They'll wake up confused.`);return;
    }

    // THRALL [npc] — bind NPC for passive income
    const thrallM=C.match(/^THRALL (.+)$/);
    if(thrallM){
      if(!gs.isVampire){push(`That power isn't yours.`);return;}
      if(!hasSkill(gs,"thrall")){push(`Unlock Thrall first.`);return;}
      const npcName=thrallM[1].toLowerCase();
      const npc=npcs.find(n=>n.name.toLowerCase()===npcName||n.id===npcName);
      if(!npc){push(`Don't know ${thrallM[1]}.`);return;}
      if(npc.b!==boro){push(`${npc.name} isn't here.`);return;}
      if((gs.thralls||[]).includes(npc.id)){push(`${npc.name} is already your thrall.`);return;}
      if((gs.thralls||[]).length>=3){push(`Three thralls is the limit. Release one first.`);return;}
      updGs(g=>applyXP({...g,thralls:[...(g.thralls||[]),npc.id]},20,"talk"));
      push(`🧛 You bite ${npc.name}. Gently. Just enough.`,`${npc.icon} ${npc.name} blinks. Something shifts behind their eyes.`,`They're yours now. +$30/day passive income.`);return;
    }

    // NIGHT MARKET — vampire-only black market available only at night
    if(C==="NIGHT MARKET"){
      if(!gs.isVampire){push(`This isn't for you.`);return;}
      const nightItems=[
        {name:"Blood Vial",       price:80,  effect:"Restore 50hp instantly. One use.",      slot:"accessory"},
        {name:"Obsidian Ring",    price:200, effect:"Charm +2. Sunlight resistance +20%.",  slot:"accessory"},
        {name:"Coffin Lining",    price:150, effect:"Warmth never drops below 20 while sleeping.", slot:"chest"},
        {name:"Shadow Cloak",     price:300, effect:"Heat -2 permanently. Toughness +1.",   slot:"chest"},
        {name:"Ancient Sigil",    price:500, effect:"All vampire abilities -1 cooldown.",   slot:"accessory"},
      ];
      push(`🌙 NIGHT MARKET — ${getBoro(boro)?.name}`,...nightItems.map(i=>`  ${i.name} $${i.price} — ${i.effect}`),``,`BUY NIGHT [item name] to purchase.`);
      return;
    }

    // BUY NIGHT [item] — buy from night market
    const buyNightM=C.match(/^BUY NIGHT (.+)$/);
    if(buyNightM){
      if(!gs.isVampire){push(`Not for you.`);return;}
      const iName=buyNightM[1].trim().toLowerCase();
      const nightItems=[
        {name:"Blood Vial",price:80},{name:"Obsidian Ring",price:200},
        {name:"Coffin Lining",price:150},{name:"Shadow Cloak",price:300},{name:"Ancient Sigil",price:500},
      ];
      const item=nightItems.find(i=>i.name.toLowerCase().includes(iName));
      if(!item){push(`Unknown night market item.`);return;}
      if(gs.cash<item.price){push(`Need $${item.price}.`);return;}
      updGs(g=>({...g,cash:g.cash-item.price,inventory:[...g.inventory,item.name]}));
      push(`Acquired: ${item.name} from the night market.`);return;
    }

    // HUNGER (vampire specific - shows blood hunger instead)
    if(C==="THIRST"){
      if(!gs.isVampire){push(`You're not that kind of thirsty.`);return;}
      const feeds=gs.feedCount||0;
      push(`🧛 Blood count: ${feeds} feeds total.`,`Thralls: ${gs.thralls?.length||0}/3`,`Feed today: ${gs.feedUsed?"Yes — sated":"No — hungry"}`,`Health: ${gs.survival.health}% · Warmth: ${gs.survival.warmth}%`,`Sunlight warning: Stay out of open spaces during the day.`);
      return;
    }

    // QUESTS — show available and active quests
    if(C==="QUESTS"){
      const available=getAvailableQuests(gs,npcs);
      const active=getActiveQuests(gs);
      if(available.length===0&&active.length===0){
        push(`No quests available.`,`Build rep with NPCs by talking to them. TALK [name].`);return;
      }
      if(active.length>0){
        push(`— ACTIVE QUESTS —`,...active.map(q=>{
          const daysLeft=q.startDay+(q.duration||3)-gs.day;
          return `  ${q.npc.toUpperCase()} — "${q.title}" (${Math.max(0,daysLeft)}d left)
    ${q.task}`;
        }));
      }
      if(available.length>0){
        push(`— AVAILABLE —`,...available.map(q=>`  ${q.npc.toUpperCase()} [Tier ${q.tier}] "${q.title}" — ACCEPT ${q.npc.toUpperCase()} ${q.tier}`));
      }
      return;
    }

    // ACCEPT [npc] [tier] — accept a quest
    const acceptM=C.match(/^ACCEPT (\w+) (\d+)$/);
    if(acceptM){
      const npcId=acceptM[1].toLowerCase();
      const tier=parseInt(acceptM[2]);
      // Special handling for secret quest
      if(npcId==="ray"&&tier===4){
        const secretQ=NPC_QUESTS.ray_secret?.[0];
        if(!secretQ){push(`No secret quest found.`);return;}
        if(gs.level<8){push(`You're not ready for that yet. Level 8 required. You're Level ${gs.level}.`);return;}
        if(!(gs.completedQuests||[]).includes("ray_q3")){push(`Complete all of Ray's quests first.`);return;}
        if((gs.activeQuests||{})[secretQ.id]){push(`Already on that quest.`);return;}
        if((gs.completedQuests||[]).includes(secretQ.id)){push(`Already completed. You forded the Hudson. That's enough.`);return;}
        const npcRay=npcs.find(n=>n.id==="ray");
        if(!npcRay||(npcRay.rep||0)<10){push(`Ray needs to trust you completely. Max out his rep first.`);return;}
        updGs(g=>({...g,activeQuests:{...(g.activeQuests||{}),[secretQ.id]:{...secretQ,startDay:g.day}},questProgress:{...(g.questProgress||{}),[secretQ.id]:{searches:0,fights:0,npcsVisited:[],visited:[]}}}));
        push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🎯 SECRET QUEST UNLOCKED`,
          `"Caulk the Wagon"`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          ``,secretQ.briefing,``,
          `Gather: Rope · Waterproof Bag · Raft Materials`,
          `Then type CAULK WAGON at the waterfront.`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
        journalEvent('questStart',"Caulk the Wagon");
        return;
      }
      const questList=NPC_QUESTS[npcId];
      if(!questList){push(`No quests from ${acceptM[1]}.`);return;}
      const quest=questList[tier-1];
      if(!quest){push(`No tier ${tier} quest for ${npcId}.`);return;}
      if((gs.completedQuests||[]).includes(quest.id)){push(`Already completed that quest.`);return;}
      if((gs.activeQuests||{})[quest.id]){push(`Already on that quest.`);return;}
      const npc=npcs.find(n=>n.id===npcId);
      if(!npc||(npc.rep||0)<quest.repRequired){push(`Need ${quest.repRequired} rep with ${npc?.name||npcId}. Currently ${npc?.rep||0}.`);return;}
      if(tier>1){const prev=questList[tier-2];if(!(gs.completedQuests||[]).includes(prev.id)){push(`Complete tier ${tier-1} first.`);return;}}
      // accept
      updGs(g=>({...g,
        activeQuests:{...(g.activeQuests||{}),[quest.id]:{...quest,startDay:g.day}},
        questProgress:{...(g.questProgress||{}),[quest.id]:{searches:0,fights:0,npcsVisited:[],visited:[]}},
      }));
      push(``,`📋 QUEST ACCEPTED: "${quest.title}"`,`${quest.briefing}`,``,quest.task,``);
      journalEvent('questStart',quest.title);
      return;
    }

    // COMPLETE [npc] [tier] — attempt to complete a quest
    const completeM=C.match(/^COMPLETE (\w+) (\d+)$/);
    if(completeM){
      const npcId=completeM[1].toLowerCase();
      const tier=parseInt(completeM[2]);
      const questList=NPC_QUESTS[npcId];
      if(!questList){push(`No quests from ${completeM[1]}.`);return;}
      const quest=questList[tier-1];
      if(!quest){push(`No tier ${tier} quest.`);return;}
      const activeQ=(gs.activeQuests||{})[quest.id];
      if(!activeQ){push(`Not on that quest. ACCEPT ${npcId.toUpperCase()} ${tier} first.`);return;}

      // Check requirements
      const prog=gs.questProgress?.[quest.id]||{};
      let canComplete=true;let failReason="";

      if(quest.requireBoro&&boro!==quest.requireBoro){canComplete=false;failReason=`You need to be in ${getBoro(quest.requireBoro)?.name}.`;}
      if(quest.requireProduct){
        const missingProd=Object.entries(quest.requireProduct).find(([k,v])=>(gs.product[k]||0)<v);
        if(missingProd){canComplete=false;failReason=`Need ${missingProd[1]} ${missingProd[0]}.`;}
      }
      if(quest.requireCorner&&world.corners?.[quest.requireCorner]!==gs.name){canComplete=false;failReason=`You need to own the ${getBoro(quest.requireCorner)?.name} corner.`;}
      if(quest.requireSearch&&(prog.searches||0)<quest.requireSearch){canComplete=false;failReason=`Need ${quest.requireSearch} searches. Done: ${prog.searches||0}.`;}
      if(quest.requireFights&&(prog.fights||0)<quest.requireFights){canComplete=false;failReason=`Need ${quest.requireFights} fights. Done: ${prog.fights||0}.`;}
      if(quest.requireAllNpcs){const visited=prog.npcsVisited||[];const allNpcIds=NPCS.map(n=>n.id);const missing=allNpcIds.filter(id=>!visited.includes(id));if(missing.length>0){canComplete=false;failReason=`Still need to talk to: ${missing.join(", ")}.`;}}
      if(quest.requireVisit&&!(prog.visited||[]).includes(quest.requireVisit)){canComplete=false;failReason=`Need to visit ${getBoro(quest.requireVisit)?.name} first.`;}
      if(quest.requireDays&&gs.day-activeQ.startDay<quest.requireDays){canComplete=false;failReason=`Need ${quest.requireDays} more days. Days elapsed: ${gs.day-activeQ.startDay}.`;}

      if(!canComplete){push(`Can't complete yet. ${failReason}`);return;}

      // Complete — apply rewards
      const r=quest.reward;
      const newActive={...(gs.activeQuests||{})};delete newActive[quest.id];
      updGs(g=>{
        let ng={...g,
          activeQuests:newActive,
          completedQuests:[...(g.completedQuests||[]),quest.id],
        };
        if(r.cash)ng={...ng,cash:ng.cash+r.cash};
        if(r.xp)ng=applyXP(ng,r.xp,"quest");
        if(r.rep){setNpcs(prev=>prev.map(n=>n.id===npcId?{...n,rep:Math.min(10,n.rep+r.rep)}:n));}
        if(r.mental)ng={...ng,survival:{...ng.survival,mental:clamp((ng.survival.mental||70)+r.mental,0,100)}};
        if(r.survival)ng={...ng,survival:{...ng.survival,...Object.fromEntries(Object.entries(r.survival).map(([k,v])=>[k,clamp((ng.survival[k]||0)+v,0,100)]))}};
        if(r.stats)ng={...ng,stats:{...ng.stats,...Object.fromEntries(Object.entries(r.stats).map(([k,v])=>[k,Math.min(10,(ng.stats[k]||0)+v)]))}};
        if(r.skillPoints)ng={...ng,skillPoints:(ng.skillPoints||0)+r.skillPoints};
        if(r.item)ng={...ng,inventory:[...ng.inventory,r.item]};
        if(r.product)ng={...ng,product:{...ng.product,...Object.fromEntries(Object.entries(r.product).map(([k,v])=>[k,(ng.product[k]||0)+v]))}};
        if(r.heat)ng={...ng,heat:clamp(ng.heat+(r.heat||0),0,10)};
        return ng;
      });

      // Build reward string
      const rewardParts=[];
      if(r.cash)rewardParts.push(`+$${r.cash}`);
      if(r.xp)rewardParts.push(`+${r.xp} XP`);
      if(r.item)rewardParts.push(`+${r.item}`);
      if(r.mental)rewardParts.push(`+${r.mental} mental`);
      if(r.skillPoints)rewardParts.push(`+${r.skillPoints} skill point`);
      if(r.stats)rewardParts.push(Object.entries(r.stats).map(([k,v])=>`+${v} ${k}`).join(", "));
      if(r.unlock)rewardParts.push(`UNLOCK: ${r.unlock}`);

      push(``,`✓ QUEST COMPLETE: "${quest.title}"`,quest.completionFlavor,``,`Rewards: ${rewardParts.join(" · ")||"gratitude"}`,``);
      journalEvent('questDone',quest.title);

      // notify world
      const ws=addWorldHistory(world,"quest",gs.name,`${gs.name} completed "${quest.title}" for ${npcId}.`,boro);
      const ws2=notifyPlayers(ws,gs.name,`📋 ${gs.name} just completed a quest for ${npcId}.`);
      setWorld(ws2);saveWorld(ws2);setWMsgs(ws2.messages||[]);
      return;
    }

    // ABANDON [npc] [tier] — drop a quest
    const abandonM=C.match(/^ABANDON (\w+) (\d+)$/);
    if(abandonM){
      const npcId=abandonM[1].toLowerCase();const tier=parseInt(abandonM[2]);
      const quest=NPC_QUESTS[npcId]?.[tier-1];
      if(!quest||(gs.activeQuests||{})[quest.id]===undefined){push(`Not on that quest.`);return;}
      const newActive={...(gs.activeQuests||{})};delete newActive[quest.id];
      updGs(g=>({...g,activeQuests:newActive}));
      setNpcs(prev=>prev.map(n=>n.id===npcId?{...n,rep:Math.max(0,(n.rep||0)-1)}:n));
      push(`Dropped "${quest.title}". ${npcId} noticed. Rep -1.`);
      journalEvent('questFail',quest.title);return;
    }

    // COLLECT DEBT — Rico/Ray debt collection mechanic
    if(C==="COLLECT DEBT"){
      const q=Object.values(gs.activeQuests||{}).find(q=>q.requireFight&&boro==="queens");
      if(!q){push(`No debt collection active here.`);return;}
      const prog=gs.questProgress?.[q.id]||{};
      updGs(g=>({...g,questProgress:{...g.questProgress,[q.id]:{...prog,fights:(prog.fights||0)+1}}}));
      push(`You find Carver's spot. Take what's owed. Fight logged.`);
      resolveCombat(gs,"dealer",
        ()=>push(`Debt collected.`),
        ()=>push(`Didn't go as planned.`),
        ()=>push(`Got away. Try again.`)
      );return;
    }

    // DELIVER LETTER — Ray tier 3
    if(C==="DELIVER LETTER"){
      const q=Object.values(gs.activeQuests||{}).find(q=>q.id==="ray_q3"&&boro==="brooklyn");
      if(!q){push(`Nothing to deliver here. Make sure you're in Brooklyn with Ray's quest active.`);return;}
      const prog=gs.questProgress?.[q.id]||{};
      updGs(g=>({...g,questProgress:{...g.questProgress,[q.id]:{...prog,visited:[...( prog.visited||[]),"brooklyn"]}}}));
      push(`You find the address. Third floor walk-up. She opens the door.`,`You hand her the envelope. She looks at it. Looks at you.`,`"Is he okay?"`,`You say yes. That's the kindest lie you've told in a long time.`,`She closes the door. You stand there for a second.`,`Then you go.`);
      return;
    }

    // VISIT MARTA — Marta tier 3 unlock
    if(C==="VISIT MARTA"){
      const martaQ3Done=(gs.completedQuests||[]).includes("marta_q3");
      if(!martaQ3Done){push(`Complete Marta's quests first.`);return;}
      if(boro!=="staten"){push(`Marta's clinic is in Staten Island.`);return;}
      updGs(g=>({...g,survival:{...g.survival,health:100}}));
      push(`Marta patches you up without a word.`,`Full health restored. No charge.`,`"Come back whenever," she says. "Door's always open."`);return;
    }

    // ── FIXER COMMANDS ──────────────────────────────────────────────────────────

    // WIRE [player] [amount] — anonymous cash transfer
    const wireM=C.match(/^WIRE (\S+) (\d+)$/);
    if(wireM){
      if(!gs.isFixer&&!hasSkill(gs,"wire_transfer")){push(`Not your style. Fixers wire money.`);return;}
      const tName=wireM[1];const amt=parseInt(wireM[2]);
      if(amt<=0||amt>gs.cash){push(`Invalid amount. Have $${gs.cash}.`);return;}
      const tData=world.players?.[tName];
      if(!tName||tName===gs.name){push(`Need a valid player name.`);return;}
      const fee=Math.ceil(amt*0.05); // 5% wire fee
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`💸 Anonymous wire received: +$${amt}. Someone's looking out for you.`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,cash:g.cash-amt-fee,wiresSent:(g.wiresSent||0)+1}));
      push(`💸 Wired $${amt} to ${tName}. Fee: $${fee}.`,`They'll never know it was you.`);return;
    }

    // BROKER [player1] [player2] — arrange deal, take cut
    const brokerM=C.match(/^BROKER (\S+) (\S+)$/);
    if(brokerM){
      if(!gs.isFixer&&!hasSkill(gs,"broker_fee")){push(`That's a Fixer move.`);return;}
      const p1=brokerM[1];const p2=brokerM[2];
      if(p1===gs.name||p2===gs.name){push(`Can't broker your own deals.`);return;}
      const deal=rnd(50,200);const cut=Math.ceil(deal*0.10);
      updGs(g=>applyXP({...g,cash:g.cash+cut,brokeredDeals:(g.brokeredDeals||0)+1},15,"deal"));
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[p1]:[...((world.playerAlerts||{})[p1]||[]),{msg:`🔧 ${gs.name} brokered a deal for you. +$${deal-cut}.`,time:Date.now()}],
          [p2]:[...((world.playerAlerts||{})[p2]||[]),{msg:`🔧 ${gs.name} brokered a deal for you. +$${deal-cut}.`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      push(`🔧 Deal brokered between ${p1} and ${p2}.`,`Your cut: $${cut}. They each got $${deal-cut}.`);return;
    }

    // CLEAN [player] — remove wanted status for $200
    if(C.startsWith("CLEAN ")){
      if(!gs.isFixer&&!hasSkill(gs,"clean_slate")){push(`That's above your pay grade.`);return;}
      const tName=raw.slice(6).trim();
      if(gs.cash<200){push(`Need $200 to clean someone's record.`);return;}
      updGs(g=>({...g,cash:g.cash-200}));
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`🔧 Someone cleaned your record. Heat wiped. Ask ${gs.name}.`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      push(`🔧 ${tName}'s record wiped. -$200.`,`Someone out there owes you one.`);return;
    }

    // CONNECTIONS — fixer sees all player locations
    if(C==="CONNECTIONS"){
      if(!gs.isFixer&&!hasSkill(gs,"network_map")){push(`You don't have that network.`);return;}
      const players=Object.entries(world.players||{}).filter(([n])=>n!==gs.name);
      if(!players.length){push(`No other players in the world yet.`);return;}
      push(`🔧 NETWORK MAP:`,...players.map(([n,d])=>`  ${n} · ${getBoro(d.borough)?.name} · Lvl ${d.level} · Heat ${d.heat||0}/10`));return;
    }

    // PRICES — fixer sees all borough prices at once
    if(C==="PRICES"){
      if(!gs.isFixer&&!hasSkill(gs,"inside_prices")){push(`You don't have those connections yet.`);return;}
      push(`🔧 ALL MARKET PRICES — Day ${gs.day}:`,...BOROUGHS.map(b=>`  ${b.short}: Weed $${mktPrice(b.id,"weed",gs.day,weather)} · Pills $${mktPrice(b.id,"pills",gs.day,weather)} · Powder $${mktPrice(b.id,"powder",gs.day,weather)}`));return;
    }

    // ── RAT COMMANDS ─────────────────────────────────────────────────────────

    // INFORM [player] — file a tip on another player
    const informM=C.match(/^INFORM (.+)$/);
    if(informM){
      if(!gs.isRat){push(`That's not your game.`);return;}
      if(gs.informsToday>=2){push(`Handler says lay low. Too many tips today.`);return;}
      const tName=informM[1].trim();
      const tData=world.players?.[tName];
      if(!tData){push(`Don't know ${tName}.`);return;}
      if(tName===gs.name){push(`Can't inform on yourself.`);return;}
      const base=40;const bonus=hasSkill(gs,"handler_trust")?30:0;const double=hasSkill(gs,"double_agent")?2:1;
      const pay=(base+bonus)*double;
      const heatSpike=rnd(2,4);
      // expose risk — 15% chance they find out
      const exposed=Math.random()<0.15;
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`🚔 Heat spiked +${heatSpike}. Someone talked. ${exposed?`Word is it was ${gs.name}.`:"Source unknown."}`,time:Date.now()}]},
        worldHistory:[...(world.worldHistory||[]).slice(-49),
          {type:"rat",actor:gs.name,detail:exposed?`${gs.name} informed on ${tName} (exposed)`:`Someone filed a tip on ${tName}`,boro,time:Date.now(),day:gs.day}]};
      setWorld(ws);saveWorld(ws);
      updGs(g=>applyXP({...g,cash:g.cash+pay,informsToday:(g.informsToday||0)+1,
        exposedAsRat:exposed?true:g.exposedAsRat,
        ratHandles:[...new Set([...(g.ratHandles||[]),tName])]},10,"scout"));
      push(`🐀 Tip filed on ${tName}.`,`Handler confirms: +$${pay}.`,exposed?`⚠ Your name came up. Watch your back.`:`Source protected.`);
      if(exposed)push(``,`🚨 ${tName} now knows it was you.`);
      return;
    }

    // MISINFORM [player] — false tip, drops their heat
    const misinformM=C.match(/^MISINFORM (.+)$/);
    if(misinformM){
      if(!gs.isRat){push(`That's not your angle.`);return;}
      if(!hasSkill(gs,"false_tip")){push(`Unlock False Tip first.`);return;}
      const tName=misinformM[1].trim();
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`🐀 Someone filed a false tip. Your heat dropped -2. Strange.`,time:Date.now()}]}};
      setWorld(ws);saveWorld(ws);
      updGs(g=>applyXP(g,8,"scout"));
      push(`🐀 False tip filed. ${tName}'s heat drops.`,`They'll be confused. That's useful.`);return;
    }

    // PLANT [player] — frame them, +3 heat to target, +$80 to you
    if(C.startsWith("PLANT ")){
      if(!gs.isRat){push(`Not your move.`);return;}
      if(!hasSkill(gs,"plant")){push(`Unlock Plant first.`);return;}
      const tName=raw.slice(6).trim();
      const ws={...world,
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:`🚔 PLANTED. Someone set you up. Heat +3. Watch who you trust.`,time:Date.now()}]},
        worldHistory:[...(world.worldHistory||[]).slice(-49),
          {type:"rat",actor:"unknown",detail:`${tName} was set up. Heat spiked.`,boro,time:Date.now(),day:gs.day}]};
      setWorld(ws);saveWorld(ws);
      updGs(g=>applyXP({...g,cash:g.cash+80},12,"scout"));
      push(`🐀 Evidence planted on ${tName}.`,`+$80. They won't see it coming.`);return;
    }

    // PANIC — witness protection heat wipe
    if(C==="PANIC"){
      if(!gs.isRat){push(`That's not your option.`);return;}
      if(!hasSkill(gs,"witness_prot")){push(`Unlock Witness Protection first.`);return;}
      if(gs.panicUsed){push(`Already used. One per life.`);return;}
      updGs(g=>({...g,heat:0,wanted:false,panicUsed:true,exposedAsRat:false}));
      push(`🚔 WITNESS PROTECTION ACTIVATED.`,`Heat wiped. Identity reset.`,`New city, same streets. Nobody knows your name.`);return;
    }

    // INTEL — sell cop patrol info (Turned capstone)
    if(C==="INTEL"){
      if(!gs.isRat){push(`You don't have that access.`);return;}
      if(!hasSkill(gs,"turned")){push(`Unlock Turned first.`);return;}
      const boroHeat=BOROUGHS.map(b=>`  ${b.short}: Heat ${b.heat}/10 — ${b.heat>7?"HOT":"clear"}`);
      push(`🚔 COP PATROL INTEL — Day ${gs.day}:`,...boroHeat,``,`Sell this to players with MSG. $50/tip suggested.`);
      updGs(g=>applyXP(g,8,"scout"));return;
    }

    // STATUS RAT — see your rat stats
    if(C==="RAT STATUS"){
      if(!gs.isRat){push(`Nothing to see.`);return;}
      push(`🐀 RAT STATUS:`,`  Handler payments: ${gs.informsToday||0}/2 today`,`  Total informed: ${(gs.ratHandles||[]).length} players`,`  Exposed: ${gs.exposedAsRat?"YES — people know":"No"}`,`  Panic used: ${gs.panicUsed?"Yes":"No"}`);return;
    }

    // EXPOSE [player] — if you know someone is a rat, expose them publicly
    if(C.startsWith("EXPOSE ")){
      const tName=raw.slice(7).trim();
      const tData=world.players?.[tName];
      if(!tData){push(`Don't know ${tName}.`);return;}
      // check world history for rat activity
      const ratted=(world.worldHistory||[]).some(h=>h.type==="rat"&&h.actor===tName);
      if(!ratted){push(`No evidence ${tName} is a rat. Could be wrong.`);return;}
      const ws=notifyPlayers(world,gs.name,`🚨 ${gs.name} exposed ${tName} as a RAT. Act accordingly.`);
      const ws2=addWorldHistory(ws,"expose",gs.name,`${tName} exposed as informant by ${gs.name}`,boro);
      setWorld(ws2);saveWorld(ws2);setWMsgs(ws2.messages||[]);
      push(`🚨 Word is out. ${tName} is a rat.`,`The streets have long memories.`);return;
    }

    // ── COP ENCOUNTER RESPONSES ──────────────────────────────────────────────

    // HIDE — find cover when patrol nearby
    if(C==="HIDE"){
      const r=COP_RESPONSES.hide;
      if(gs.survival.energy<r.energyCost){push(`Too tired to hide properly.`);return;}
      const success=Math.random()<(gs.isUndoc?0.9:gs.archetype?.id==="ghost"?0.95:r.successRate);
      if(success){
        updGs(g=>({...g,heat:clamp(g.heat-r.heatDrop,0,10),patrolEncountered:false,survival:{...g.survival,energy:clamp(g.survival.energy-r.energyCost,0,100)}}));
        push(`🫥 ${r.msg}`,`Heat -${r.heatDrop}. You're clear.`);
      } else {
        updGs(g=>({...g,heat:clamp(g.heat+1,0,10),patrolEncountered:false}));
        push(`They spotted something. You walk away fast.`,`Heat +1.`);
      }
      return;
    }

    // RUN — flee the borough
    if(C==="RUN"){
      const r=COP_RESPONSES.run;
      if(gs.survival.energy<r.energyCost){push(`Can't run on empty.`);return;}
      const b2=getBoro(boro);const adj=b2?.adjacent||[];
      if(!adj.length){push(`Nowhere to run.`);return;}
      const dest=adj[rnd(0,adj.length-1)];
      setBoro(dest);
      updGs(g=>({...g,heat:clamp(g.heat-0.5,0,10),patrolEncountered:false,survival:{...g.survival,energy:clamp(g.survival.energy-r.energyCost,0,100),health:clamp(g.survival.health-r.healthCost,0,100)}}));
      push(`🏃 ${r.msg}`,`Ended up in ${getBoro(dest)?.name}. Took some damage.`);return;
    }

    // BRIBE — pay off the cop
    if(C==="BRIBE"){
      const r=COP_RESPONSES.bribe;
      const cost=r.cashCost+Math.floor(gs.heat*10);
      if(gs.cash<cost){push(`Need $${cost} to bribe. Have $${gs.cash}.`);return;}
      const charmBonus=gs.stats.charm>=7?0.15:0;
      const success=Math.random()<(r.successRate+charmBonus);
      if(success){
        updGs(g=>({...g,cash:g.cash-cost,heat:clamp(g.heat-r.heatDrop,0,10),patrolEncountered:false}));
        push(`💵 ${r.msg}`,`-$${cost}. Heat -${r.heatDrop}. Expensive but clean.`);
      } else {
        updGs(g=>({...g,cash:g.cash-cost,heat:clamp(g.heat+2,0,10),patrolEncountered:false}));
        push(`They took the money AND called it in.`,`-$${cost}. Heat +2. Crooked all the way down.`);
      }
      return;
    }

    // TALK — talk your way out
    if(C==="TALK"&&gs.patrolEncountered){
      const r=COP_RESPONSES.talk;
      const siqBonus=gs.stats.streetiq>=8?0.2:0;
      const veteranBonus=gs.archetype?.id==="veteran"?0.15:0;
      const success=Math.random()<(r.successRate+siqBonus+veteranBonus);
      if(success){
        updGs(g=>({...g,heat:clamp(g.heat-r.heatDrop,0,10),patrolEncountered:false}));
        push(`🗣 ${r.msg}`,`Heat -${r.heatDrop}. You're clear.`);
      } else {
        updGs(g=>({...g,heat:clamp(g.heat+1,0,10),patrolEncountered:false}));
        push(`They didn't buy it. Heat +1.`);
      }
      return;
    }

    // WANTED STATUS command
    if(C==="HEAT"||C==="WANTED STATUS"){
      const tier=getWantedTier(Math.round(gs.heat));
      const weight=getCarryWeight(gs.product);
      const overCash=gs.cash>MAX_CARRY_CASH;
      const overWeight=weight>MAX_CARRY_WEIGHT;
      push(`🚔 WANTED STATUS: ${"★".repeat(tier.stars)||"☆"} ${tier.name}`,
        tier.desc,
        `Heat: ${Math.round(gs.heat)}/10 · Cop presence here: ${getCopPresence(boro,world.copPresence,gs.day)}/10`,
        tier.cantEnter.length?`BLOCKED FROM: ${tier.cantEnter.join(", ").toUpperCase()}`:`No borough restrictions`,
        ``,
        `Product weight: ${weight.toFixed(1)}/${MAX_CARRY_WEIGHT}${overWeight?" ⚠ OVERLOADED":""}`,
        `Cash: $${gs.cash}${overCash?` ⚠ CARRYING TOO MUCH — you're a target`:""}`);
      return;
    }

    // STASH CASH — deposit cash to safe house (keeps it below robbery threshold)
    if(C==="STASH CASH"){
      const safe=world.safehouses?.[boro];
      if(!safe||(safe.owner!==gs.name&&safe.crewOwner!==gs.crew)){push(`No safe house here. BUY SAFEHOUSE $500 first.`);return;}
      const toStash=Math.max(0,gs.cash-100); // keep $100 on you
      if(toStash<=0){push(`Nothing to stash.`);return;}
      updGs(g=>({...g,cash:g.cash-toStash,cashStash:(g.cashStash||0)+toStash}));
      push(`💰 Stashed $${toStash} in safe house.`,`Carrying $${gs.cash-toStash}. Below the target line.`);return;
    }

    // RETRIEVE CASH
    if(C==="RETRIEVE CASH"){
      if(!gs.cashStash||gs.cashStash<=0){push(`Nothing stashed.`);return;}
      const safe=world.safehouses?.[boro];
      if(!safe||(safe.owner!==gs.name&&safe.crewOwner!==gs.crew)){push(`No safe house here.`);return;}
      updGs(g=>({...g,cash:g.cash+g.cashStash,cashStash:0}));
      push(`💰 Retrieved $${gs.cashStash} from safe house.`);return;
    }

    // CAPTAIN — check if captain is active and where
    if(C==="CAPTAIN"){
      if(!world.captainBoro||world.captainDay!==gs.day){
        push(`The Captain hasn't been spotted today.`,`They'll surface when heat across all boroughs peaks.`);
      } else {
        const capBoro=getBoro(world.captainBoro);
        push(`🚔 THE CAPTAIN is in ${capBoro?.name}.`,`Extremely dangerous. High-level patrol.`,`Players who engage: huge XP + $${rnd(200,400)} bounty reward.`,`Players who avoid: nothing.`,`Rat players can INFORM on rivals to redirect them toward The Captain.`);
      }
      return;
    }

    // FRONT [product] [qty] — Schemer/Fixer can buy product on credit
    const frontM=C.match(/^FRONT (\w+) (\d+)$/);
    if(frontM){
      if(!gs.isFixer&&!hasSkill(gs,"front_credit")&&!hasSkill(gs,"silver_tongue")){push(`You don't have the credit for that.`);return;}
      const pKey=frontM[1].toLowerCase();const qty=parseInt(frontM[2]);
      if(!PRODUCTS[pKey]){push(`Unknown product.`);return;}
      const price=Math.round(mktPrice(boro,pKey,gs.day,weather)*PRODUCTS[pKey].bm*qty);
      if(gs.debtOwed>200){push(`Already owe $${gs.debtOwed}. Pay your debt first.`);return;}
      updGs(g=>applyXP({...g,product:{...g.product,[pKey]:g.product[pKey]+qty},debtOwed:(g.debtOwed||0)+price},5*qty,"deal"));
      push(`Product fronted. ${qty}× ${PRODUCTS[pKey].name}.`,`Owe $${price} by next day or rep drops.`);return;
    }

    // PAY DEBT
    if(C==="PAY DEBT"){
      if(!gs.debtOwed||gs.debtOwed<=0){push(`No debt.`);return;}
      if(gs.cash<gs.debtOwed){push(`Need $${gs.debtOwed}. Have $${gs.cash}.`);return;}
      updGs(g=>({...g,cash:g.cash-g.debtOwed,debtOwed:0}));
      push(`Debt paid. Clean slate.`);return;
    }

    // ARBITRAGE — show cross-borough profit opportunities
    if(C==="ARBITRAGE"){
      const lines=["💹 ARBITRAGE — Buy cheap, sell high:"];
      Object.entries(PRODUCTS).forEach(([pKey,prod])=>{
        const prices=BOROUGHS.map(b=>({b,p:mktPrice(b.id,pKey,gs.day,weather)}));
        const cheapest=prices.reduce((a,b)=>b.p<a.p?b:a);
        const priciest=prices.reduce((a,b)=>b.p>a.p?b:a);
        const margin=Math.round((priciest.p-cheapest.p*prod.bm));
        lines.push(`  ${prod.icon} ${prod.name}: Buy ${cheapest.b.short} $${Math.round(cheapest.p*prod.bm)} → Sell ${priciest.b.short} $${priciest.p} = +$${margin}/unit`);
      });
      push(...lines,``,`Weight limit: ${MAX_CARRY_WEIGHT} units total.`);return;
    }

    // ── HEAT REDUCTION COMMANDS ──────────────────────────────────────────────

    // LAY LOW — spend time lying low, costs a day's energy, reduces heat
    if(C==="LAY LOW"){
      if(gs.survival.energy<30){push(`Too tired. REST first.`);return;}
      const heatDrop=rnd(1,3);
      const energyCost=40;
      const msgs=[
        "You pull your hood up and stay off the main blocks all day. Nobody sees you.",
        "You find a spot — library, church basement, laundromat — and you wait. By evening the block feels different.",
        "You move borough to borough, never staying long enough to matter. Heat drops.",
        "You crash at different spots all day. Keep moving. Stay invisible.",
        "You swap your jacket, change your hat, take the long way everywhere. Old tradecraft.",
      ];
      updGs(g=>({...g,
        heat:clamp(g.heat-heatDrop,0,10),
        survival:{...g.survival,energy:clamp(g.survival.energy-energyCost,0,100)},
      }));
      push(`🫥 ${msgs[rnd(0,msgs.length-1)]}`,`Heat -${heatDrop}. Energy -${energyCost}.`);
      return;
    }

    // CHANGE UP — change appearance, costs cash, bigger heat drop
    if(C==="CHANGE UP"){
      const cost=40;
      if(gs.cash<cost){push(`Need $${cost} for new clothes, haircut, different look.`);return;}
      const heatDrop=rnd(2,4);
      const msgs=[
        "New jacket from the thrift store on Flatbush. Different shoes. You don't look like yourself anymore. That's the point.",
        "You get a cut at the barbershop on 149th. Pay cash. The barber doesn't ask questions. Regulars don't ask questions either.",
        "Goodwill run. Everything you're wearing goes in a bag. New look, new block presence.",
        "You change everything — jacket, hat, shoes. Walk different. Talk different. Cops are looking for who you were, not who you are now.",
      ];
      updGs(g=>({...g,
        cash:g.cash-cost,
        heat:clamp(g.heat-heatDrop,0,10),
      }));
      push(`👔 ${msgs[rnd(0,msgs.length-1)]}`,`-$${cost}. Heat -${heatDrop}.`);
      return;
    }

    // SKIP TOWN — move to a random adjacent borough, significant heat drop
    if(C==="SKIP TOWN"){
      if(gs.survival.energy<25){push(`Too tired to move right now.`);return;}
      const b2=getBoro(boro);
      const adj=b2?.adjacent||[];
      if(!adj.length){push(`Nowhere to go from here.`);return;}
      const dest=adj[rnd(0,adj.length-1)];
      const heatDrop=rnd(2,4);
      setBoro(dest);
      updGs(g=>({...g,
        heat:clamp(g.heat-heatDrop,0,10),
        survival:{...g.survival,energy:clamp(g.survival.energy-25,0,100)},
        patrolEncountered:false,
      }));
      const ws={...world,players:{...(world.players||{}),[gs.name]:{level:gs.level,borough:dest,lastSeen:Date.now(),heat:Math.round(Math.max(0,gs.heat-heatDrop)),archId:gs.archetype?.id||'veteran'}}};
      setWorld(ws);saveWorld(ws);
      push(`🚇 You get out. Head to ${getBoro(dest)?.name}.`,`Different block. Different energy. Heat -${heatDrop}.`);
      return;
    }

    // LIE LOW — stay in safe house for the day, maximal heat drop
    if(C==="LIE LOW"){
      const safe=world.safehouses?.[boro];
      const ownsIt=safe&&(safe.owner===gs?.name||safe.ownerLower===gs?.name?.toLowerCase()||safe.crewOwner===gs?.crew);
      if(!ownsIt){push(`Need a safe house here to lie low. BUY SAFEHOUSE first.`);return;}
      const heatDrop=2+(safe.level||1);
      updGs(g=>({...g,
        heat:clamp(g.heat-heatDrop,0,10),
        survival:{...g.survival,energy:Math.min(100,g.survival.energy+20),warmth:100},
        patrolEncountered:false,
        wanted:g.heat-heatDrop<7?false:g.wanted,
      }));
      push(`🏠 You lock the door and stay off the street all day.`,
        `Nobody knows where you are. That's the whole point.`,
        `Heat -${heatDrop}. Warmed up. Energy restored a little.`);
      return;
    }

    // CONFESS — go to Dee at the shelter, costs nothing, small heat drop + mental boost
    // (represents connecting with social services, getting your name off active lists)
    if(C==="CONFESS"){
      const dee=npcs.find(n=>n.id==="dee");
      if(!dee){push(`Can't find Dee right now.`);return;}
      if(dee.rep<3){push(`Dee doesn't know you well enough yet. TALK to her first.`);return;}
      const heatDrop=1;
      updGs(g=>applyXP({...g,
        heat:clamp(g.heat-heatDrop,0,10),
        survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)},
      },8,"talk"));
      setNpcs(prev=>prev.map(n=>n.id==="dee"?{...n,rep:Math.min(10,n.rep+1)}:n));
      push(`You find Dee at the shelter. Tell her what's been happening.`,
        `She listens without judgment. That's rarer than it sounds.`,
        `"Come back if it gets worse," she says. You think you will.`,
        `Heat -${heatDrop}. Mental health up. Rep with Dee up.`);
      return;
    }

    if(C==="VISION"){
      if(!gs.isSchizo){push("You don't see visions. Type LOOK.");return;}
      const hasVisionSkill=(gs.skills||[]).includes("the_knowing");
      if(hasVisionSkill){
        const others=Object.entries(world.players||{}).filter(([n])=>n!==gs.name);
        if(others.length>0){
          const [n2,d2]=others[rnd(0,others.length-1)];
          push("🌀 TRUE VISION",n2+" is in "+getBoro(d2.borough)?.name+". Heat "+( d2.heat||0)+"/10.","The voices confirmed it.");
        } else {push("🌀 You are the only one out here. The city belongs to you.");}
      } else {push("🌀 VISION unlocks at Level 4 (The Knowing skill). Type LOOK for regular visions.");}
      return;
    }
    // HEAT command — alias for WANTED STATUS
    if(C==="HEAT"){
      const tier=getWantedTier(Math.round(gs.heat));
      const weight=getCarryWeight(gs.product);
      const overCash=gs.cash>MAX_CARRY_CASH;
      const overWeight=weight>MAX_CARRY_WEIGHT;
      push(`🚔 HEAT: ${Math.round(gs.heat)}/10 — ${"★".repeat(tier.stars)||"☆"} ${tier.name}`,
        tier.desc,
        `Cop presence here: ${getCopPresence(boro,world.copPresence,gs.day)}/10`,
        tier.cantEnter.length?`Borough restrictions: ${tier.cantEnter.join(", ").toUpperCase()}`:`No borough restrictions`,
        ``,
        `Ways to cool down:`,
        `  LAY LOW (-1-3 heat, costs energy)`,
        `  CHANGE UP (-2-4 heat, costs $40)`,
        `  SKIP TOWN (move borough, -2-4 heat)`,
        `  LIE LOW (safe house, -${2+(world.safehouses?.[boro]?.level||1)} heat)`,
        `  HIDE/BRIBE/TALK (during patrol encounters)`,
        `  SLEEP (-2 heat per night)`,
        overCash?`⚠ Carrying $${gs.cash} — you're a robbery target`:"",
        overWeight?`⚠ Carrying ${weight.toFixed(1)} weight units — you're visible`:"");
      return;
    }

    // ── OREGON TRAIL SECRET QUEST ─────────────────────────────────────────────

    // CAULK WAGON — attempt to ford the Hudson River
    if(C==="CAULK WAGON"||C==="FORD THE RIVER"||C==="CAULK THE WAGON"){
      // Check eligibility
      const raySecretQ=(gs.activeQuests||{})["ray_secret_q1"];
      if(!raySecretQ){
        if(gs.level>=8&&(gs.completedQuests||[]).includes("ray_q3")){
          push(`Ray mentioned something about the Hudson. Go TALK to Ray in Manhattan.`);
        } else {
          push(`You don't know what that means yet.`);
        }
        return;
      }
      if(boro!=="manhattan"&&boro!=="brooklyn"){
        push(`You need to be at the Hudson. Head to Manhattan or Brooklyn waterfront.`);return;
      }
      // Check supplies
      const hasRope=gs.inventory.includes("Rope");
      const hasBag=gs.inventory.includes("Waterproof Bag");
      const hasRaft=gs.inventory.includes("Raft Materials");
      if(!hasRope||!hasBag||!hasRaft){
        const missing=[];
        if(!hasRope)missing.push("Rope (SEARCH or BUY ITEM rope)");
        if(!hasBag)missing.push("Waterproof Bag (SEARCH or BUY ITEM waterproof bag)");
        if(!hasRaft)missing.push("Raft Materials (SEARCH in Staten Island)");
        push(`You need supplies first:`, ...missing.map(m=>`  · ${m}`));return;
      }

      // The attempt — D&D style with multiple phases
      push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🚣 THE HUDSON FORD`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `You drag the raft to the water's edge at 2am. The city glitters across the river.`,
        `Ray watches from the bank. He doesn't say anything.`,
        ``,
        `You push off.`,
        ``);

      // Multi-phase crossing with dice rolls
      const toughness=gs.stats?.toughness||5;
      const hustle=gs.stats?.hustle||5;
      const streetiq=gs.stats?.streetiq||5;
      const phase1=roll(20)+Math.floor(toughness/2); // physical endurance
      const phase2=roll(20)+Math.floor(streetiq/2);  // navigating the current
      const phase3=roll(20)+Math.floor(hustle/2);    // final push

      setTimeout(()=>{
        push(`Phase 1 — The Current`,
          `Toughness check: d20=${phase1-Math.floor(toughness/2)} +${Math.floor(toughness/2)} = ${phase1} vs DC 12`,
          phase1>=12?`The current hits hard but you hold the rope. You're through the worst of it.`:`The current nearly takes you. You lose the bag. Health -15.`);
      },500);
      setTimeout(()=>{
        push(``,`Phase 2 — Navigation`,
          `Street IQ check: d20=${phase2-Math.floor(streetiq/2)} +${Math.floor(streetiq/2)} = ${phase2} vs DC 10`,
          phase2>=10?`You read the water right. Stay out of the shipping lanes.`:`You drift south. Takes longer. Energy -20.`);
      },1000);
      setTimeout(()=>{
        push(``,`Phase 3 — The Final Push`,
          `Hustle check: d20=${phase3-Math.floor(hustle/2)} +${Math.floor(hustle/2)} = ${phase3} vs DC 8`,
          phase3>=8?`You make it. You drag yourself up the bank on the other side. Breathing hard.`:`The raft gives out twenty yards from shore. You swim for it.`);
      },1500);

      const success=phase1>=12||phase2>=10||phase3>=8; // need at least 2 of 3
      const fullSuccess=phase1>=12&&phase2>=10&&phase3>=8;

      setTimeout(()=>{
        if(fullSuccess){
          push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `✓ YOU FORDED THE HUDSON.`,
            ``,
            `Perfect crossing. Ray is still watching from the Manhattan bank.`,
            `You can see him from here. Small. Smiling.`,
            ``,
            `He'll tell that story for years.`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
        } else if(success){
          push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `✓ YOU MADE IT ACROSS.`,
            ``,
            `Not pretty. Not clean. But across.`,
            `That's the whole point.`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
        } else {
          push(``,`✗ The Hudson wins this one.`,
            `You're pulled out downstream. Alive. Barely.`,
            `Ray meets you at the bank. "Try again when you're ready." He means it.`,``);
        }

        if(success){
          // Complete quest and award
          const newActive={...(gs.activeQuests||{})};
          delete newActive["ray_secret_q1"];
          const medal={...getItemById("oregon_medal"),name:"Oregon Trail Medal"};
          updGs(g=>applyXP({...g,
            cash:g.cash,
            activeQuests:newActive,
            completedQuests:[...(g.completedQuests||[]),"ray_secret_q1"],
            inventory:[...g.inventory,"Oregon Trail Medal"],
            title:"THE FORDIST",
            survival:{...g.survival,
              health:clamp(g.survival.health-(fullSuccess?5:25),1,100),
              mental:Math.min(100,(g.survival.mental||70)+50),
              energy:clamp(g.survival.energy-40,0,100),
            },
          },500,"quest"));
          setNpcs(prev=>prev.map(n=>n.id==="ray"?{...n,rep:10}:n));
          // Announce to world
          const ws2=notifyPlayers(world,gs.name,`🏅 ${gs.name} FORDED THE HUDSON RIVER. The Oregon Trail lives.`);
          const ws3=addWorldHistory(ws2,"legend",gs.name,`${gs.name} caulked the wagon and forded the Hudson River. Level ${gs.level}.`,boro);
          setWorld(ws3);saveWorld(ws3);setWMsgs(ws3.messages||[]);
          setTimeout(()=>push(``,`🏅 AWARD: Oregon Trail Medal`,`🏅 TITLE: THE FORDIST`,`+500 XP · +50 mental · Ray's rep maxed.`,`Your name will be on the Wall of Legends.`,``),200);
        } else {
          updGs(g=>({...g,survival:{...g.survival,health:clamp(g.survival.health-30,1,100),energy:clamp(g.survival.energy-30,0,100)}}));
        }
      },2000);
      return;
    }

    // ACCEPT for secret quest — needs level check
    // Override ACCEPT to check for secret quest
    // (normal ACCEPT handles this but we add level gate)

    // BUY ITEM — allow purchasing quest items
    // Already handled in BUY ITEM command — rope/bag/raft findable via SEARCH

    // MENTAL — check mental health status
    if(C==="MENTAL"){
      const m=gs.survival.mental||70;
      const stage=getMentalStage(m);
      push(`${stage.icon} MENTAL HEALTH: ${stage.name.toUpperCase()} (${m}/100)`,
        stage.desc,
        m<60?`Consequences active — erratic behavior possible.`:`Holding together.`,
        ``,
        `What helps: TALK [npc] · WRITE [letter] · SHELTER · REST · SLEEP`,
        `What hurts: hunger, cold, heat, withdrawal, isolation`);
      return;
    }

    push(`Unknown command. Type HELP.`);
  };

  const panelBuy=()=>{if(!gs)return;const weather=getWeather(gs.day);const price=Math.round(mktPrice(boro,mProd,gs.day,weather)*PRODUCTS[mProd].bm);const total=price*mQty;if(total>gs.cash){push(`Need $${total}.`);return;}updGs(g=>applyXP({...g,cash:g.cash-total,product:{...g.product,[mProd]:g.product[mProd]+mQty}},5*mQty,"deal"));push(`Bought ${mQty}× ${PRODUCTS[mProd].name} for $${total}.`);};
  const panelSell=()=>{if(!gs)return;const weather=getWeather(gs.day);if(gs.product[mProd]<mQty){push(`Only have ${gs.product[mProd]}.`);return;}const total=mktPrice(boro,mProd,gs.day,weather)*mQty;updGs(g=>applyXP({...g,cash:g.cash+total,product:{...g.product,[mProd]:g.product[mProd]-mQty}},8*mQty,"deal"));push(`Sold ${mQty}× ${PRODUCTS[mProd].name} for $${total}.`);};
  const npcTalk=(npc)=>{if(npc.b!==boro){push(`${npc.name} isn't here.`);return;}push(`> talk ${npc.name}`,...npc.lines);setNpcs(prev=>prev.map(n=>n.id===npc.id?{...n,rep:Math.min(n.rep+1,10)}:n));updGs(g=>applyXP(g,5,"talk"));};
  const joinCrewPanel=(name,crew)=>{if(gs.crew){push(`Leave first.`);return;}const ws={...world,crews:{...world.crews,[name]:{...crew,members:[...crew.members,gs.name]}}};setWorld(ws);saveWorld(ws);updGs(g=>({...g,crew:name,crewRole:"member"}));push(`Joined ${name}.`);};
  const acceptQuest=(npcId,tier)=>{
    const questList=NPC_QUESTS[npcId];if(!questList)return;
    const quest=questList[tier-1];if(!quest)return;
    if((gs.completedQuests||[]).includes(quest.id)){push(`Already completed.`);return;}
    if((gs.activeQuests||{})[quest.id]){push(`Already active.`);return;}
    const npc=npcs.find(n=>n.id===npcId);
    if(!npc||(npc.rep||0)<quest.repRequired){push(`Need ${quest.repRequired} rep with ${npc?.name}.`);return;}
    updGs(g=>({...g,activeQuests:{...(g.activeQuests||{}),[quest.id]:{...quest,startDay:g.day}},questProgress:{...(g.questProgress||{}),[quest.id]:{searches:0,fights:0,npcsVisited:[],visited:[]}}}));
    push(`📋 Quest accepted: "${quest.title}"`,quest.task);journalEvent('questStart',quest.title);
  };
  const completeQuest=(npcId,tier)=>{
    push(`Type COMPLETE ${npcId.toUpperCase()} ${tier} to complete this quest.`);
  };
  const abandonQuest=(npcId,tier)=>{
    const quest=NPC_QUESTS[npcId]?.[tier-1];if(!quest)return;
    const na={...(gs.activeQuests||{})};delete na[quest.id];
    updGs(g=>({...g,activeQuests:na}));
    setNpcs(prev=>prev.map(n=>n.id===npcId?{...n,rep:Math.max(0,(n.rep||0)-1)}:n));
    push(`Dropped "${quest.title}". Rep -1.`);journalEvent('questFail',quest.title);
  };
  const unlockSkill=(skill)=>{
    if(!gs)return;
    if((gs.skills||[]).includes(skill.id)){push(`Already learned.`);return;}
    if(gs.level<skill.level){push(`Need Level ${skill.level}.`);return;}
    if((gs.skillPoints||0)<skill.cost){push(`Need ${skill.cost} skill points.`);return;}
    updGs(g=>({...g,skills:[...(g.skills||[]),skill.id],skillPoints:(g.skillPoints||0)-skill.cost}));
    push(`✓ ${skill.name} learned.`,skill.desc);
  };
  const unequipSlot=(slot)=>{
    if(!gs)return;
    const itemId=gs.equipment?.[slot];if(!itemId)return;
    const item=getItemById(itemId);
    updGs(g=>({...g,equipment:{...g.equipment,[slot]:null},inventory:item?[...g.inventory,item.name]:g.inventory}));
    push(`Unequipped ${item?.name||slot}.`);
  };
  const others=Object.entries(world.players||{}).filter(([n])=>n!==gs?.name).map(([n,d])=>({name:n,...d}));

  // ── BOOT ──────────────────────────────────────────────────────────────────
  if(phase==="boot")return(<>
    <style>{FONTS+`@keyframes fadeIn{from{opacity:0;transform:translateX(-3px)}to{opacity:1}}@keyframes blink{50%{opacity:0}}`}</style>
    <div style={{minHeight:"100vh",background:"#0d0f0f",display:"flex",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'Share Tech Mono',monospace"}}>
      <div style={{maxWidth:500,width:"100%"}}>
        <div style={{fontFamily:"'VT323',monospace",fontSize:56,color:"#e9c46a",letterSpacing:4,textShadow:"0 0 28px #e9c46a88,0 0 60px #e9c46a33",marginBottom:4}}>HOBO QUEST</div>
        <div style={{fontSize:10,color:"#888",marginBottom:26,letterSpacing:3}}>SURVIVE · HUSTLE · CONQUER · NYC</div>
        <div style={{borderLeft:"2px solid #161616",paddingLeft:14}}>
          {bootL.map((line,i)=><div key={i} style={{fontSize:11,color:(typeof line==="string"&&line.includes("WARNING"))?"#ff6b6b":(typeof line==="string"&&line.includes("BOOT"))?"#e9c46a":"#4a8f5a",marginBottom:3,animation:"fadeIn 0.3s ease"}}>{line}</div>)}
          {bootL.length<BOOT.length&&<span style={{color:"#e9c46a",animation:"blink 1s infinite"}}>█</span>}
        </div>
      </div>
    </div>
  </>);

  // ── CHARACTER ─────────────────────────────────────────────────────────────
  if(phase==="character")return(<>
    <style>{FONTS}</style>
    <div style={{minHeight:"100vh",background:"#0d0f0f",color:"#c0c0b8",padding:"20px 16px",overflowY:"auto",fontFamily:"'Share Tech Mono',monospace"}}>
      <div style={{maxWidth:660,margin:"0 auto",paddingTop:12}}>
        <div style={{fontFamily:"'VT323',monospace",fontSize:42,color:"#e9c46a",letterSpacing:3,textShadow:"0 0 16px #e9c46a55",marginBottom:3}}>CHARACTER CREATION</div>
        <div style={{fontSize:9,color:"#aaa",letterSpacing:2,marginBottom:22}}>WHO ARE YOU OUT HERE?</div>
        <div style={{fontSize:9,color:"#aaa",letterSpacing:2,marginBottom:10}}>// SELECT ARCHETYPE</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginBottom:22,gridAutoRows:"1fr"}}>
          {ARCHETYPES.map(a=><div key={a.id} onClick={()=>setSelA(a.id)} style={{border:`1px solid ${selA===a.id?a.color:"#1a1a1a"}`,background:selA===a.id?`${a.color}0b`:"#090909",padding:"11px 9px",cursor:"pointer",transition:"all 0.2s",boxShadow:selA===a.id?`0 0 16px ${a.color}22`:"none"}}>
            <div style={{fontSize:18,marginBottom:4}}>{a.icon}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:a.color,letterSpacing:2,marginBottom:4}}>{a.name}</div>
            <div style={{fontSize:8,color:"#444",lineHeight:1.5,marginBottom:7}}>{a.desc}</div>
            <div style={{borderTop:"1px solid #111",paddingTop:5}}>{Object.entries(a.stats).map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:7,marginBottom:1}}><span style={{color:"#666"}}>{k.toUpperCase()}</span><span style={{color:selA===a.id?a.color:"#252525"}}>{v}</span></div>)}</div>
            <div style={{marginTop:5,fontSize:7,color:"#666"}}>STARTS: {a.gear.join(" · ")}</div>
            {a.special&&<div style={{marginTop:4,fontSize:7,color:"#1e4e3a",borderTop:"1px solid #111",paddingTop:3,lineHeight:1.4}}>{a.special}</div>}
          </div>)}
        </div>
        {/* BACKSTORY QUESTIONS */}
        {selA&&!bsDone&&(
          <div style={{marginBottom:20}}>
            <div style={{fontSize:9,color:"#aaa",letterSpacing:2,marginBottom:12}}>// YOUR STORY — Question {bsStep+1} of {BACKSTORY_QUESTIONS.length}</div>
            <div style={{fontSize:12,color:"#d4c9b0",marginBottom:12,lineHeight:1.6}}>{BACKSTORY_QUESTIONS[bsStep]?.question}</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {BACKSTORY_QUESTIONS[bsStep]?.options.map(opt=>{
                const isSelected=backstory[BACKSTORY_QUESTIONS[bsStep].id]===opt.id;
                return <div key={opt.id} onClick={()=>{
                  const newBs={...backstory,[BACKSTORY_QUESTIONS[bsStep].id]:opt.id};
                  setBackstory(newBs);
                  if(bsStep<BACKSTORY_QUESTIONS.length-1){setBsStep(bsStep+1);}
                  else{setBsDone(true);}
                }} style={{padding:"9px 12px",border:`1px solid ${isSelected?"#e9c46a44":"#1a1a1a"}`,background:isSelected?"#e9c46a08":"#090909",cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{fontSize:10,color:isSelected?"#e9c46a":"#aaa",lineHeight:1.5}}>{opt.label}</div>
                  {isSelected&&<div style={{fontSize:8,color:"#555",marginTop:4,fontStyle:"italic"}}>{opt.flavor}</div>}
                </div>;
              })}
            </div>
            {bsStep>0&&<div onClick={()=>setBsStep(bsStep-1)} style={{fontSize:8,color:"#333",marginTop:8,cursor:"pointer"}}>← back</div>}
          </div>
        )}
        {bsDone&&(
          <div style={{marginBottom:16,padding:"8px 12px",border:"1px solid #e9c46a22",background:"#e9c46a05"}}>
            <div style={{fontSize:8,color:"#e9c46a",letterSpacing:2,marginBottom:6}}>YOUR STORY</div>
            {Object.entries(backstory).map(([qId,aId])=>{
              const q=BACKSTORY_QUESTIONS.find(q=>q.id===qId);
              const a=q?.options.find(o=>o.id===aId);
              return a?<div key={qId} style={{fontSize:8,color:"#666",marginBottom:3}}>{a.label}</div>:null;
            })}
            <div onClick={()=>{setBackstory({});setBsStep(0);setBsDone(false);}} style={{fontSize:7,color:"#333",marginTop:6,cursor:"pointer"}}>change answers</div>
          </div>
        )}
        <div style={{fontSize:9,color:"#aaa",letterSpacing:2,marginBottom:8}}>// STREET NAME + PIN</div>
        {/* Name input — Enter moves to PIN */}
        <div style={{marginBottom:8}}>
          <input
            value={nameIn}
            onChange={e=>setNameIn(e.target.value)}
            onKeyDown={e=>{
              if(e.key==="Enter"&&nameIn.trim()){
                // move focus to PIN input
                document.getElementById("pin-input")?.focus();
              }
            }}
            placeholder="Street name or handle..."
            autoFocus
            style={{width:"100%",boxSizing:"border-box",background:"#090909",border:`1px solid ${nameIn?"#e9c46a66":"#1e1e1e"}`,color:"#e9c46a",fontFamily:"'Share Tech Mono',monospace",fontSize:14,padding:"9px 12px",outline:"none",letterSpacing:1,marginBottom:6}}
          />
          {nameIn.trim()&&<div style={{fontSize:8,color:"#333",marginBottom:8}}>↵ Enter then type your 4-digit PIN</div>}
          <input
            id="pin-input"
            value={pinIn}
            onChange={e=>{
              const val=e.target.value.replace(/\D/g,"").slice(0,4);
              setPinIn(val);
              // auto-submit when 4 digits entered
              if(val.length===4&&nameIn.trim()&&!cName){
                setTimeout(async()=>{
                  const found=await loadChar(nameIn.trim(),val);
                  if(found){setSavedChar(found);setCName(nameIn.trim());}
                  else{setCName(nameIn.trim());}
                },50);
              }
            }}
            onKeyDown={e=>{
              if(e.key==="Enter"&&nameIn.trim()&&pinIn.length===4&&!cName){
                (async()=>{
                  const found=await loadChar(nameIn.trim(),pinIn);
                  if(found){setSavedChar(found);setCName(nameIn.trim());}
                  else{setCName(nameIn.trim());}
                })();
              }
            }}
            placeholder="4-digit PIN"
            maxLength={4}
            inputMode="numeric"
            style={{width:"100%",boxSizing:"border-box",background:"#090909",border:`1px solid ${pinIn.length===4?"#e9c46a":"#1e1e1e"}`,color:"#e9c46a",fontFamily:"'Share Tech Mono',monospace",fontSize:18,padding:"9px 12px",outline:"none",letterSpacing:8,textAlign:"center"}}
          />
          {nameIn.trim()&&pinIn.length<4&&<div style={{fontSize:8,color:"#666",marginTop:4,textAlign:"center"}}>{"·".repeat(pinIn.length)}{"○".repeat(4-pinIn.length)}</div>}
        </div>
        {/* Save found — show continue or new options */}
        {cName&&savedChar&&(
          <div style={{border:"1px solid #e9c46a33",padding:"10px 12px",background:"#e9c46a06",marginBottom:12}}>
            <div style={{color:"#e9c46a",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,marginBottom:4}}>SAVE FOUND — {savedChar.name}</div>
            <div style={{fontSize:9,color:"#555",fontFamily:"'Share Tech Mono',monospace",marginBottom:8}}>
              {savedChar.archetype?.name} · Level {savedChar.level} · Day {savedChar.day} · ${savedChar.cash}
            </div>
            <div style={{display:"flex",gap:8}}>
              <div onClick={()=>continueGame(savedChar)} style={{padding:"10px 18px",background:"#e9c46a",color:"#0d0f0f",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,cursor:"pointer"}}>CONTINUE →</div>
              <div onClick={()=>{setSavedChar(null);setCName("");setNameIn("");setPinIn("");setSelA(null);setBsDone(false);setBackstory({});setBsStep(0);}} style={{padding:"10px 14px",background:"#e6394620",border:"1px solid #e63946",color:"#e63946",fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:2,cursor:"pointer"}}>NEW</div>
            </div>
          </div>
        )}
        {/* No save found — show archetype + backstory gates then start */}
        {cName&&!savedChar&&(
          <div>
            {(!selA||!bsDone)&&<div style={{fontSize:9,color:"#e63946",marginBottom:8}}>
              {!selA?"← Select an archetype above first.":!bsDone?"← Answer the backstory questions above.":""}
            </div>}
            {selA&&bsDone&&(
              <div onClick={startGame} style={{background:"#e9c46a",color:"#0d0f0f",fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:3,padding:"14px 28px",cursor:"pointer",display:"inline-block",boxShadow:"0 0 28px #e9c46a44",marginTop:4}}>
                HIT THE STREETS →
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  </>);

  // ── GAME ──────────────────────────────────────────────────────────────────
  if(phase==="game"&&gs){
    const arch=gs.archetype;
    const weather=getWeather(gs.day);
    const lvlPct=clamp(((gs.xp-(LVL_XP[gs.level-1]||0))/((LVL_XP[gs.level]||LVL_XP[gs.level-1])-(LVL_XP[gs.level-1]||0)))*100,0,100);
    const wColors={clear:"#e9c46a",cloudy:"#888",rain:"#457b9d",fog:"#aaa",blizzard:"#a8dadc",heatwave:"#e63946",storm:"#8b5cf6"};
    return(<>
      <style>{FONTS+`@keyframes blink{50%{opacity:0}}@keyframes wanted{0%,100%{opacity:1}50%{opacity:0.3}}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#0a0a0a}::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:2px}::-webkit-scrollbar-thumb:hover{background:#3a3a3a}input[type=number]::-webkit-inner-spin-button{opacity:0}*{box-sizing:border-box}`}</style>
      <div style={{width:"100vw",height:"100vh",display:"flex",flexDirection:"column",background:"#0d0f0f",overflow:"hidden",fontFamily:"'Share Tech Mono',monospace"}}>

        {/* TOP BAR */}
        <div style={{borderBottom:"1px solid #111",display:"flex",alignItems:"center",padding:"0 12px",gap:10,background:"#080808",height:38,flexShrink:0}}>
          <div style={{fontFamily:"'VT323',monospace",fontSize:21,color:"#e9c46a",letterSpacing:3,textShadow:"0 0 10px #e9c46a55"}}>HOBO QUEST</div>
          {gs&&<div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:"#666",marginLeft:8,letterSpacing:1}}>
            {(()=>{
              const h=gameTime.hour>=24?gameTime.hour-24:gameTime.hour;
              const ampm=gameTime.hour<12?"AM":gameTime.hour<24?"PM":"AM";
              const h12=h===0?12:h>12?h-12:h;
              const m=String(gameTime.minute).padStart(2,"0");
              const isNight=gameTime.hour>=20||gameTime.hour<6;
              const isDawn=gameTime.hour>=6&&gameTime.hour<10;
              return <span style={{color:isNight?"#9d4edd":isDawn?"#f4a261":"#666"}}>{h12}:{m}{ampm} {isNight?"🌙":isDawn?"🌅":"☀️"}</span>;
            })()}
          </div>}
          <div style={{fontSize:8,color:"#191919"}}>|</div>
          <div style={{fontSize:9,color:arch.color}}>{gs.name}</div>
          {gs.crew&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #e9c46a33",color:"#e9c46a66"}}>{gs.crew.toUpperCase()}</div>}
          {gs.wanted&&<div style={{fontSize:7,padding:"1px 5px",background:"#e6394615",border:"1px solid #e63946",color:"#e63946",animation:"wanted 1s infinite"}}>🚨 WANTED</div>}
          {gs.ghostMode&&<div style={{fontSize:7,padding:"1px 5px",background:"#a8dadc15",border:"1px solid #a8dadc",color:"#a8dadc",animation:"wanted 1.5s infinite"}}>👻 GHOST</div>}
          {gs.isJunkie&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #8b5cf644",color:"#8b5cf6"}}>💉 HABIT</div>}
          {gs.isHustler&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #2a9d8f44",color:"#2a9d8f"}}>💵 HUSTLER</div>}
          {gs.isVampire&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #9d4edd44",color:"#9d4edd",background:"#9d4edd11"}}>🧛 {gs.feedUsed?"SATED":"HUNGRY"}</div>}
          {gs.isFixer&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #06d6a044",color:"#06d6a0"}}>🔧 {gs.brokeredDeals||0} deals</div>}
          {gs.isRat&&<div style={{fontSize:7,padding:"1px 5px",border:`1px solid ${gs.exposedAsRat?"#ff6b6b":"#ff6b6b44"}`,color:"#ff6b6b",background:gs.exposedAsRat?"#ff6b6b22":"transparent"}}>🐀 {gs.exposedAsRat?"EXPOSED":"undercover"}</div>}
          {gs.prestige>0&&<div style={{fontSize:7,padding:"1px 5px",border:"1px solid #e9c46a44",color:"#e9c46a"}}>{PRESTIGE_BADGES[gs.prestige-1]}</div>}
          {gs.retireEligible&&<div style={{fontSize:7,padding:"1px 5px",background:"#e9c46a22",border:"1px solid #e9c46a",color:"#e9c46a",cursor:"pointer"}} onClick={()=>setCmd("RETIRE")}>🏆 RETIRE?</div>}
          {/* weather in top bar */}
          <div style={{fontSize:9,color:wColors[weather.id]||"#888"}}>{weather.icon} {weather.name}</div>
          <div style={{fontSize:8,color:"#777"}}>DAY {gs.day}</div>
          <div style={{flex:1}}/>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            {(gs.skillPoints||0)>0&&<div style={{fontSize:7,padding:"1px 5px",background:"#e9c46a22",border:"1px solid #e9c46a",color:"#e9c46a",cursor:"pointer"}} onClick={()=>setTab("skills")}>⚡{gs.skillPoints}pt</div>}
            {!gs.isFixer&&!gs.isRat&&<div style={{fontSize:7,padding:"1px 5px",border:`1px solid ${(gs.hustleCount||0)>=(HUSTLE_DAILY_MAX[gs.archetype?.id||"veteran"]-1)?"#e63946":"#2a2a2a"}`,color:(gs.hustleCount||0)>=(HUSTLE_DAILY_MAX[gs.archetype?.id||"veteran"])?"#e63946":"#333"}}>H {gs.hustleCount||0}/{HUSTLE_DAILY_MAX[gs.archetype?.id||"veteran"]}</div>}
            {Object.keys(gs.activeQuests||{}).length>0&&<div style={{fontSize:7,padding:"1px 5px",background:"#2a9d8f22",border:"1px solid #2a9d8f",color:"#2a9d8f",cursor:"pointer"}} onClick={()=>setTab("quests")}>📋{Object.keys(gs.activeQuests||{}).length}</div>}
            <div style={{fontSize:8,color:"#777"}}>LVL {gs.level}</div>
            <div style={{width:60,height:3,background:"#141414",border:"1px solid #1a1a1a"}}><div style={{height:"100%",width:`${lvlPct}%`,background:"#e9c46a",transition:"width 0.4s"}}/></div>
            <div style={{fontSize:7,color:"#666"}}>{xpNext(gs.xp)} XP</div>
          </div>
          <div style={{width:6,height:6,borderRadius:"50%",background:pulse?"#2a9d8f":"#1a1a1a",transition:"background 0.3s"}}/>
          {others.slice(0,3).map(p=><div key={p.name} style={{fontSize:7,color:p.borough===boro?"#e63946":"#1e6e62"}}>● {p.name}</div>)}
        </div>

        {/* MAIN CONTENT ROW */}
        <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

        {/* LEFT */}
        <div style={{borderRight:"1px solid #0f0f0f",padding:9,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,width:195,flexShrink:0}}>
          <CharPortrait gs={gs}/>
          <div style={{display:"flex",justifyContent:"space-around",padding:"4px 0",borderBottom:"1px solid #111"}}>
            <div style={{textAlign:"center"}}><div style={{fontSize:14,fontFamily:"'VT323',monospace",color:"#e9c46a"}}>${gs.cash}</div><div style={{fontSize:6,color:"#666"}}>CASH</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:14,fontFamily:"'VT323',monospace",color:Math.round(gs.heat)>=8?"#e63946":"#555"}}>{Math.round(gs.heat)}/10</div><div style={{fontSize:6,color:"#666"}}>HEAT</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:14,fontFamily:"'VT323',monospace",color:"#2a9d8f"}}>{gs.level}</div><div style={{fontSize:6,color:"#666"}}>LVL</div></div>
          </div>
          <div>
            <div style={{fontSize:7,color:"#888",letterSpacing:2,marginBottom:4}}>// PRODUCT</div>
            {Object.entries(PRODUCTS).map(([k,p])=><div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:8,marginBottom:2}}><span style={{color:"#383838"}}>{p.icon} {p.name}</span><span style={{color:gs.product[k]>0?"#e9c46a":"#222"}}>{gs.product[k]}</span></div>)}
            {Object.entries(gs.cooked||{}).filter(([,v])=>v>0).map(([n,q])=>{const r=RECIPES[n];return r?<div key={n} style={{display:"flex",justifyContent:"space-between",fontSize:8,marginBottom:2}}><span style={{color:"#2a9d8f"}}>{r.icon} {n}</span><span style={{color:"#2a9d8f"}}>{q}</span></div>:null;})}
          </div>
          <div><div style={{fontSize:7,color:"#888",letterSpacing:2,marginBottom:4}}>// STATS</div>
            <StatBar label="HUSTLE"    value={gs.stats.hustle}    color="#e9c46a"/>
            <StatBar label="STREET IQ" value={gs.stats.streetiq}  color="#a8dadc"/>
            <StatBar label="TOUGHNESS" value={gs.stats.toughness} color="#e63946"/>
            <StatBar label="CHARM"     value={gs.stats.charm}     color="#f4a261"/>
          </div>
          <div><div style={{fontSize:7,color:"#888",letterSpacing:2,marginBottom:4}}>// SURVIVAL</div>
            <SrvBar label="HUNGER" value={gs.survival.hunger} icon="🍞"/>
            <SrvBar label="WARMTH" value={gs.survival.warmth} icon={gs.isVampire?"🌙":weather.id==="blizzard"?"❄️":"🔥"}/>
            <SrvBar label="HEALTH" value={gs.survival.health} icon="❤️"/>
            <SrvBar label="ENERGY" value={gs.survival.energy} icon="⚡"/>
            {(()=>{
              const mStage=getMentalStage(gs.survival.mental||70);
              return <div style={{marginBottom:4}}>
                <SrvBar label="MENTAL" value={gs.survival.mental||70} icon={mStage.icon}/>
                {(gs.survival.mental||70)<60&&<div style={{fontSize:6,color:mStage.color,marginTop:1,fontFamily:"'Share Tech Mono',monospace",padding:"1px 0"}}>{mStage.name.toUpperCase()} — {mStage.desc}</div>}
              </div>;
            })()}
            {!gs.isVampire&&(gs.addiction||0)>0&&<div style={{marginBottom:4}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:8,fontFamily:"'Share Tech Mono',monospace",color:"#444",marginBottom:2}}>
                <span>{CLASS_SUBSTANCE[gs.archetype?.id||"veteran"]?.icon} ADDICT</span>
                <span style={{color:(gs.addiction||0)>79?"#e63946":(gs.addiction||0)>59?"#f4a261":"#8b5cf6"}}>{gs.addiction||0}%</span>
              </div>
              <div style={{height:3,background:"#111",border:"1px solid #161616"}}>
                <div style={{height:"100%",width:`${gs.addiction||0}%`,background:(gs.addiction||0)>79?"#e63946":(gs.addiction||0)>59?"#f4a261":"#8b5cf6",transition:"width 0.5s"}}/>
              </div>
            </div>}
          </div>
          <div>
            <div style={{fontSize:7,color:"#888",letterSpacing:2,marginBottom:4}}>// INVENTORY ({gs.inventory.length})</div>
            <InvGrid items={gs.inventory} equipment={gs.equipment} onEquip={(item)=>{
              const slot=item.slot;const oldItemId=gs.equipment?.[slot];
              const oldItem=oldItemId?getItemById(oldItemId):null;
              const newInv=gs.inventory.filter(i=>i!==item.name&&i!==item.id);
              if(oldItem)newInv.push(oldItem.name);
              updGs(g=>({...g,equipment:{...g.equipment,[slot]:item.id},inventory:newInv}));
              push(`Equipped: ${ITEM_RARITY[item.rarity].prefix||""}${item.name}`);
            }}/>
          </div>
        </div>

        {/* CENTER */}
        <div style={{display:"flex",flexDirection:"column",borderRight:"1px solid #0f0f0f",flex:1,minWidth:0,overflow:"hidden"}}>
          {!tutDone&&gs&&(
            <div style={{padding:"5px 12px",background:"#e9c46a08",borderBottom:"1px solid #e9c46a22",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:8,color:"#e9c46a",fontFamily:"'Share Tech Mono',monospace"}}>📖 {TUTORIAL_STEPS[Math.min(tutStep,TUTORIAL_STEPS.length-2)]?.msg?.slice(0,60)}...</div>
              <div onClick={()=>{setTutDone(true);setTutStep(TUTORIAL_STEPS.length-1);}} style={{fontSize:8,color:"#888",cursor:"pointer",marginLeft:8,padding:"2px 6px",border:"1px solid #333"}}>skip ×</div>
            </div>
          )}
          <div ref={feedRef} style={{flex:1,padding:"10px 14px",overflowY:"auto",display:"flex",flexDirection:"column",gap:2,minHeight:0,scrollBehavior:"smooth"}}>
            {feed.map((line,i)=>{
              const s=typeof line==="string"?line:"";
              const div=s.startsWith("—");const isC=s.startsWith(">");const lvl=s.startsWith("★");const warn=s.startsWith("⚠")||s.startsWith("🚨")||s.startsWith("☠")||s.startsWith("❄️");
              return <div key={i} style={{fontSize:div?10:13,color:lvl?"#e9c46a":warn?"#ff6b6b":isC?"#6aaa6a":div?"#3a3a3a":"#d4c9b0",letterSpacing:div?2:0,borderBottom:div?"1px solid #1a1a1a":"none",paddingBottom:div?4:0,marginBottom:div?4:0,lineHeight:1.8,minHeight:s===""?7:"auto",fontWeight:lvl||warn?"bold":"normal"}}>{s}</div>;
            })}
            <span style={{color:"#e9c46a",animation:"blink 1.3s infinite",fontSize:12}}>█</span>
              {gs&&gs.crew&&(world.crews?.[gs.crew]?.wars||[]).length>0&&(
                <span style={{fontSize:8,color:"#e63946",letterSpacing:1,fontFamily:"'Share Tech Mono',monospace",marginLeft:8}}>⚔ AT WAR</span>
              )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden",width:185,flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #111",background:"#080808"}}>
            {[["map","MAP"],["market","MKT"],["skills","⚡"],["gear","🗡"],["quests","📋"],["safe","🏠"],["shelter","🛏"],["npcs","NPC"],["chat",unread>0?`📡${unread}`:"📡"],["crews","👥"],["journal","📖"]].map(([id,label])=><div key={id} onClick={()=>{setTab(id);if(id==="chat")setUnread(0);}} style={{flex:1,padding:"5px 0",textAlign:"center",fontSize:8,letterSpacing:1,color:tab===id?"#e9c46a":"#252525",borderBottom:tab===id?"2px solid #e9c46a":"2px solid transparent",cursor:"pointer",minWidth:24}}>{label}</div>)}
          </div>
          <div style={{flex:1,padding:9,overflowY:"auto"}}>

            {tab==="map"&&<>
              <BoroMap active={boro} onSelect={setBoro} world={world} weather={weather.id} day={gs.day}/>
              <div style={{fontSize:7,color:"#888",letterSpacing:2,marginBottom:5}}>// REP</div>
              {BOROUGHS.map(b=><div key={b.id} style={{display:"flex",justifyContent:"space-between",fontSize:7,marginBottom:2}}>
                <span style={{color:"#666"}}>{b.short}</span>
                <span style={{color:gs.rep[b.id]>0?b.color:"#191919"}}>{"█".repeat(Math.min(gs.rep[b.id],5))}{"░".repeat(Math.max(5-gs.rep[b.id],0))}</span>
              </div>)}
              {others.length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// ONLINE</div>
              {others.map(p=><div key={p.name} style={{fontSize:7,marginBottom:2,display:"flex",justifyContent:"space-between"}}><span style={{color:p.borough===boro?"#e63946":"#1e6e62"}}>● {p.name} · {getBoro(p.borough)?.short}</span>{p.heat>=9&&<span style={{color:"#e63946",fontSize:6}}>🚨</span>}</div>)}</>}
              {Object.entries(world.bounties||{}).filter(([,v])=>v>0).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// BOUNTIES</div>{Object.entries(world.bounties||{}).filter(([,v])=>v>0).map(([n,a])=><div key={n} style={{fontSize:7,color:"#e63946",marginBottom:2}}>☠ {n}: ${a}</div>)}</>}
              {(world.pvpLog||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// RECENT HITS</div>{(world.pvpLog||[]).slice(-4).reverse().map((ev,i)=><div key={i} style={{fontSize:7,color:ev.won?"#e63946":"#444",marginBottom:2}}>{ev.attacker}→{ev.victim} · {getBoro(ev.boro)?.short} · {ev.won?`$${ev.stolen}`:"failed"}</div>)}</>}
              {(world.worldHistory||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// WORLD HISTORY</div>{(world.worldHistory||[]).slice(-5).reverse().map((h,i)=><div key={i} style={{fontSize:7,color:"#4a6e4a",marginBottom:2,lineHeight:1.4}}>[Day {h.day}] {h.detail}</div>)}</>}
              {(world.legends||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// LEGENDS</div>{(world.legends||[]).slice(-3).reverse().map((l,i)=><div key={i} style={{fontSize:7,color:"#e9c46a",marginBottom:2}}>{l.badge} {l.name} · P{l.prestige}</div>)}</>}
            </>}

            {tab==="market"&&<MktPanel bId={boro} day={gs.day} prod={mProd} setProd={setMProd} qty={mQty} setQty={setMQty} onBuy={panelBuy} onSell={panelSell} playerProd={gs.product} weather={weather}/>}
            {tab==="skills"&&<SkillPanel gs={gs} onUnlock={unlockSkill}/>}
            {tab==="quests"&&<QuestPanel gs={gs} npcs={npcs} onAccept={acceptQuest} onComplete={completeQuest} onAbandon={abandonQuest} boro={boro}/>}
            {tab==="gear"&&<GearPanel gs={gs} onUnequip={unequipSlot} onEquip={(slot)=>{
  // equip from inventory via panel - find first unequipped item for that slot
  const item=gs.inventory.map(n=>BASE_ITEMS.find(b=>b.name===n||b.id===n)).find(i=>i&&i.slot===slot&&gs.equipment?.[slot]!==i.id);
  if(!item){push(`No ${slot} item in inventory.`);return;}
  const oldId=gs.equipment?.[slot];const oldItem=oldId?getItemById(oldId):null;
  const newInv=gs.inventory.filter(n=>n!==item.name&&n!==item.id);
  if(oldItem)newInv.push(oldItem.name);
  updGs(g=>({...g,equipment:{...g.equipment,[slot]:item.id},inventory:newInv}));
  push(`Equipped: ${item.name} (${slot})`);
}} day={gs.day} boro={boro}/>}

            {tab==="safe"&&<SafePanel gs={gs} world={world} boro={boro} onBuy={()=>buyOrUpgradeSafe(false)} onUpgrade={()=>buyOrUpgradeSafe(true)} onStash={stashProduct} onUnstash={unstashProduct} onRest={restSafe}/>}

            {tab==="npcs"&&<NpcPanel npcs={npcs} bId={boro} onTalk={npcTalk}/>}

            {tab==="chat"&&(()=>{
              const sendMsg=async()=>{
                if(!mIn.trim())return;
                const entry={from:gs.name,text:mIn.trim(),time:Date.now(),boro,arch:gs.archetype?.id||"veteran"};
                const newMsgs=[...(world.messages||[]).slice(-49),entry];
                const ws={...world,messages:newMsgs};
                setWorld(ws);
                setWMsgs(newMsgs);
                setMIn("");
                // Direct Supabase update for instant delivery to all players
                try{
                  await sendChatMessage(entry);
                }catch(e){
                  // Fallback to full saveWorld
                  saveWorld(ws);
                }
                setTimeout(()=>{const el=document.getElementById("chat-msgs");if(el)el.scrollTop=el.scrollHeight;},50);
              };
              const aColors={veteran:"#e63946",schemer:"#f4a261",ghost:"#a8dadc",hustler:"#2a9d8f",junkie:"#e9c46a",undocumented:"#f4a261",vampire:"#9d4edd",fixer:"#06d6a0",rat:"#ff6b6b"};
              return <div style={{display:"flex",flexDirection:"column",fontFamily:"'Share Tech Mono',monospace"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                  <div style={{color:"#999",letterSpacing:2,fontSize:8}}>// WORLD CHAT</div>
                  <div style={{fontSize:6,color:"#555"}}>{wMsgs.length} msgs · {Object.entries(world.players||{}).filter(([,d])=>(Date.now()-(d.lastSeen||0))<120000).length} online</div>
                </div>
                {/* Activity strip */}
                {(world.notifications||[]).slice(-3).length>0&&<div style={{marginBottom:6,borderBottom:"1px solid #1a1a1a",paddingBottom:5}}>
                  <div style={{fontSize:6,color:"#444",letterSpacing:1,marginBottom:3}}>RECENT ACTIVITY</div>
                  {(world.notifications||[]).slice(-3).map((n,i)=>(
                    <div key={i} style={{fontSize:7,color:"#666",marginBottom:1,lineHeight:1.4}}>
                      {n.icon} {n.msg}
                    </div>
                  ))}
                </div>}
                <div style={{marginBottom:6,display:"flex",gap:3,flexWrap:"wrap"}}>
                  {Object.entries(world.players||{})
                  .filter(([n,d])=>(Date.now()-(d.lastSeen||0))<120000) // online = active in last 2 mins
                  .map(([n,d])=>(
                    <div key={n} style={{fontSize:6,padding:"1px 4px",border:`1px solid ${aColors[d.archId]||"#2a9d8f"}55`,color:aColors[d.archId]||"#2a9d8f"}}>
                      {n} {getBoro(d.borough)?.short||"?"}
                      <span style={{color:"#2a9d8f",marginLeft:2}}>●</span>
                    </div>
                  ))}
                {Object.entries(world.players||{}).filter(([n,d])=>(Date.now()-(d.lastSeen||0))>=120000&&(Date.now()-(d.lastSeen||0))<3600000).length>0&&(
                  <div style={{fontSize:6,color:"#333",marginTop:2}}>
                    + {Object.entries(world.players||{}).filter(([n,d])=>(Date.now()-(d.lastSeen||0))>=120000&&(Date.now()-(d.lastSeen||0))<3600000).length} away
                  </div>
                )}
                </div>
                <div id="chat-msgs" style={{overflowY:"auto",marginBottom:6,display:"flex",flexDirection:"column",gap:4,maxHeight:240,minHeight:60}}>
                  {wMsgs.length===0&&<div style={{color:"#333",fontSize:7}}>No messages. Say something.</div>}
                  {wMsgs.slice(-30).map((m,i)=>{
                    const isMe=m.from===gs.name;
                    const mc=aColors[m.arch]||"#2a9d8f";
                    const ts=m.time?new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";
                    if(!m.from)return <div key={i} style={{color:"#444",fontSize:7,textAlign:"center",fontStyle:"italic"}}>{m.text}</div>;
                    return <div key={i} style={{borderLeft:`2px solid ${isMe?"#e9c46a":mc}`,paddingLeft:5,paddingBottom:2}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{color:isMe?"#e9c46a":mc,fontSize:7}}>{m.from}</span>
                        <span style={{color:"#333",fontSize:6}}>{getBoro(m.boro)?.short} {ts}</span>
                      </div>
                      <div style={{color:isMe?"#d4c9b0":"#bbb",fontSize:9,lineHeight:1.5,wordBreak:"break-word"}}>{m.text}</div>
                    </div>;
                  })}
                </div>
                <div style={{display:"flex",gap:4,borderTop:"1px solid #1a1a1a",paddingTop:5}}>
                  <input value={mIn} onChange={e=>setMIn(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")sendMsg();}} placeholder="say something..." maxLength={200} autoComplete="off"
                    style={{flex:1,background:"#0a0a0a",border:"1px solid #252525",color:"#e9c46a",fontFamily:"'Share Tech Mono',monospace",fontSize:9,padding:"5px 7px",outline:"none"}}/>
                  <div onClick={sendMsg} style={{padding:"5px 8px",background:"#e9c46a22",border:"1px solid #e9c46a55",color:"#e9c46a",fontSize:10,cursor:"pointer",flexShrink:0}}>→</div>
                </div>
                <div style={{fontSize:6,color:"#333",marginTop:3}}>MSG [text] from command line · {Object.keys(world.players||{}).length} online</div>
              </div>;
            })()}
            {tab==="shelter"&&<div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
              <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// SHELTERS TONIGHT</div>
              {gs.isUndoc&&<div style={{color:"#e63946",fontSize:7,marginBottom:8,padding:"4px 6px",border:"1px solid #e6394633",background:"#e6394608"}}>No ID means no bed. You know this. CONNECT for community alternatives.</div>}
              {BOROUGHS.map(b=>{
                const s=SHELTERS[b.id];if(!s)return null;
                const beds=shelterBeds(b.id,gs.day);const taken=world.shelterCheckins?.[b.id]||0;const avail=Math.max(0,beds-taken);
                const isHere=b.id===boro;
                return <div key={b.id} style={{padding:"6px 8px",marginBottom:4,border:`1px solid ${isHere?"#e9c46a33":"#161616"}`,background:isHere?"#e9c46a05":"#090909"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{color:isHere?"#e9c46a":"#555",fontSize:9}}>{b.short} {s.name}</span>
                    <span style={{color:avail>0?"#2a9d8f":"#e63946",fontSize:8}}>{avail}/{beds}</span>
                  </div>
                  <div style={{color:"#999",fontSize:7,marginBottom:3}}>Curfew {s.curfew}:00 · {s.rules[0]}</div>
                  {isHere&&avail>0&&!gs.isUndoc&&<div onClick={()=>{const raw2="checkin";const fakeE={key:"Enter"};setCmd("checkin");setTimeout(()=>{const evt={key:"Enter"};handleCmd({...evt,target:{value:"checkin"}});},50);}} style={{fontSize:7,color:"#2a9d8f",cursor:"pointer",padding:"2px 0"}}>→ CHECKIN here</div>}
                  {isHere&&avail===0&&<div style={{fontSize:7,color:"#e63946"}}>FULL tonight.</div>}
                </div>;
              })}
              <div style={{marginTop:8,fontSize:7,color:"#666",borderTop:"1px solid #111",paddingTop:6}}>
                <div style={{marginBottom:3}}>🧠 Mental: {gs.survival.mental||70}%</div>
                {(gs.survival.mental||70)<30&&<div style={{color:"#e63946"}}>Critical. Find a shelter or talk to someone.</div>}
                <div style={{color:"#1e4e3a",marginTop:4}}>Letters written to world log: {world.letters?.length||0}</div>
                <div onClick={()=>{push(`— LETTERS FROM THE STREET —`,...(world.letters||[]).slice(-6).map(l=>`${l.from} · Day ${l.day}: "${l.text}"`));}} style={{color:"#2a9d8f",cursor:"pointer",marginTop:3}}>→ READ LETTERS</div>
              </div>
            </div>}
            {tab==="crews"&&<CrewPanel gs={gs} world={world} onJoin={joinCrewPanel}/>}
            {tab==="journal"&&<div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
              <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// {gs.name.toUpperCase()}'s JOURNAL</div>
              {/* backstory summary */}
              {gs.backstory&&Object.keys(gs.backstory).length>0&&<div style={{marginBottom:8,padding:"6px 8px",border:"1px solid #e9c46a22",background:"#e9c46a05"}}>
                <div style={{fontSize:7,color:"#e9c46a",letterSpacing:1,marginBottom:4}}>ORIGIN</div>
                {Object.entries(gs.backstory).map(([qId,aId])=>{
                  const q=BACKSTORY_QUESTIONS.find(q=>q.id===qId);
                  const a=q?.options.find(o=>o.id===aId);
                  return a?<div key={qId} style={{fontSize:7,color:"#555",marginBottom:2,lineHeight:1.4}}>{a.label}</div>:null;
                })}
              </div>}
              {/* journal entries */}
              <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:320,overflowY:"auto"}}>
                {(gs.journal||[]).length===0&&<div style={{color:"#999"}}>Nothing written yet. Live some days first.</div>}
                {(gs.journal||[]).slice(-20).map((entry,i)=>(
                  <div key={i} style={{fontSize:7,color:"#6a8a6a",lineHeight:1.6,borderLeft:"1px solid #1e3e1e",paddingLeft:6}}>{entry}</div>
                ))}
              </div>
              <div style={{marginTop:8,fontSize:7,color:"#666"}}>JOURNAL · BACKSTORY commands</div>
            </div>}

          </div>
        </div>

        {/* COMBAT OVERLAY */}
        {combat&&(
          <div style={{position:"fixed",inset:0,background:"#000000ee",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,fontFamily:"'Share Tech Mono',monospace"}}>
            <div style={{maxWidth:460,width:"92%",border:"1px solid #e6394666",background:"#0a0a0a",padding:20,maxHeight:"80vh",overflowY:"auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:"#e63946",letterSpacing:2}}>⚔ {combat.enemy?.name}</div>
                <div style={{fontSize:9,color:"#999"}}>Round {combat.round}</div>
              </div>
              {/* HP bars */}
              <div style={{marginBottom:10}}>
                <div style={{fontSize:8,color:"#555",marginBottom:2}}>Enemy HP</div>
                <div style={{height:6,background:"#1a1a1a",border:"1px solid #2a2a2a",marginBottom:6}}>
                  <div style={{height:"100%",width:`${(combat.enemy?.hp/combat.enemy?.maxHp)*100}%`,background:"#e63946",transition:"width 0.3s"}}/>
                </div>
                <div style={{fontSize:8,color:"#555",marginBottom:2}}>Your HP</div>
                <div style={{height:6,background:"#1a1a1a",border:"1px solid #2a2a2a"}}>
                  <div style={{height:"100%",width:`${(combat.playerHp/combat.cs?.hp)*100}%`,background:"#2a9d8f",transition:"width 0.3s"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:7,color:"#444",marginTop:2}}>
                  <span>{combat.enemy?.hp}/{combat.enemy?.maxHp}</span><span>{combat.playerHp}/{combat.cs?.hp}</span>
                </div>
              </div>
              {/* Action buttons */}
              <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                <div onClick={()=>doCombatRound("fight")} style={{padding:"7px 14px",background:"#e6394620",border:"1px solid #e63946",color:"#e63946",cursor:"pointer",fontSize:10,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>⚔ FIGHT</div>
                <div onClick={()=>doCombatRound("flee")} style={{padding:"7px 14px",background:"#2a2a2a",border:"1px solid #444",color:"#888",cursor:"pointer",fontSize:10,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>🏃 FLEE</div>
                {(COMBAT_ABILITIES[gs.archetype?.id]||[]).map(a=>{
                  const cd=abilityCooldowns[a.id]||0;
                  return <div key={a.id} onClick={()=>cd===0&&doCombatRound("ability",a.id)} style={{padding:"7px 10px",background:cd>0?"#111":`${gs.archetype?.color||"#e9c46a"}15`,border:`1px solid ${cd>0?"#222":gs.archetype?.color||"#e9c46a"}`,color:cd>0?"#333":gs.archetype?.color||"#e9c46a",cursor:cd>0?"not-allowed":"pointer",fontSize:9,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1,opacity:cd>0?0.5:1}}>
                    {a.name}{cd>0?` (${cd}r)`:""}
                  </div>;
                })}
              </div>
              {/* Last combat log lines */}
              <div style={{borderTop:"1px solid #1a1a1a",paddingTop:8,maxHeight:140,overflowY:"auto"}}>
                {combat.log.slice(-8).map((line,i)=>{
                  const s=typeof line==="string"?line:"";
                  const isHit=s.includes("HIT")||s.includes("damage")||s.includes("down.");
                  const isMiss=s.includes("MISS")||s.includes("dodge");
                  const isCrit=s.includes("CRITICAL");
                  return <div key={i} style={{fontSize:9,color:isCrit?"#f4a261":isHit?"#e63946":isMiss?"#777":"#888",marginBottom:2,lineHeight:1.5}}>{s}</div>;
                })}
              </div>
            </div>
          </div>
        )}

        {/* RARE EVENT OVERLAY */}
        {rareEvent&&(
          <div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,fontFamily:"'Share Tech Mono',monospace"}}>
            <div style={{maxWidth:420,width:"90%",border:"1px solid #e9c46a44",background:"#0d0d0d",padding:24}}>
              <div style={{fontSize:10,color:"#e9c46a55",letterSpacing:3,marginBottom:8}}>⚡ RARE EVENT</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:"#e9c46a",letterSpacing:2,marginBottom:10}}>{rareEvent.title}</div>
              <div style={{fontSize:12,color:"#a09080",lineHeight:1.7,marginBottom:20}}>{rareEvent.desc}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {rareEvent.choices.map((ch,i)=>(
                  <div key={i} onClick={()=>{updGs(g=>ch.fn(g));push(``,ch.outcome,``);
                    const ws=addWorldHistory(world,"event",gs.name,`${gs.name} faced "${rareEvent.title}"`,boro);
                    const ws2=notifyPlayers(ws,gs.name,`⚡ ${gs.name} just faced a rare event on the street.`);
                    setWorld(ws2);saveWorld(ws2);setWMsgs(ws2.messages||[]);
                    setRareEvent(null);}}
                    style={{padding:"10px 14px",border:"1px solid #e9c46a33",background:"#e9c46a08",color:"#e9c46a",cursor:"pointer",fontSize:11,transition:"all 0.2s"}}>
                    {i+1}. {ch.label}
                  </div>
                ))}
              </div>
              <div style={{fontSize:8,color:"#666",marginTop:12}}>Or type CHOOSE 1{rareEvent.choices.length>1?" / CHOOSE 2":""} in the command line.</div>
            </div>
          </div>
        )}

        </div>{/* end MAIN CONTENT ROW */}

        {/* BOTTOM */}
        <div style={{borderTop:"1px solid #111",display:"flex",alignItems:"center",padding:"0 16px",gap:7,background:"#080808",minHeight:46,flexShrink:0}}>
          <span style={{color:"#f4d03f",fontSize:13,flexShrink:0}}>▶</span>
          <input ref={inputRef} value={cmd} onChange={e=>setCmd(e.target.value)} onKeyDown={handleCmd} placeholder="type a command  (HELP for full list)" autoFocus onBlur={e=>{setTimeout(()=>{try{e.target.focus();}catch{}},100);}} style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#f4d03f",fontFamily:"'Share Tech Mono',monospace",fontSize:14,letterSpacing:1,minWidth:0}}/>
          <div onClick={()=>inputRef.current?.focus()} style={{fontSize:8,color:"#666",padding:"4px 8px",border:"1px solid #1a1a1a",cursor:"pointer",flexShrink:0}}>ENTER ↵</div>
        </div>

      </div>
    </>);
  }
  return null;
}
