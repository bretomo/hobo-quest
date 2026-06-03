'use client'
import { useState, useEffect, useRef } from "react";
import { loadWorld, saveWorld as sbSaveWorld, loadCharacter, saveCharacter, subscribeToWorld, unsubscribe, sendChatMessage, cleanStaleCharacters, deleteCharacter } from '../lib/supabase';

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
const MIN_SELL_PLAYERS = 1;       // even one seller starts dropping prices

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
  {min:0,  max:19, name:"Clean",     icon:"○", color:"#2a9d8f", desc:"No dependency. You're in control.",
    effects:{},
  },
  {min:20, max:39, name:"Curious",   icon:"◔", color:"#e9c46a", desc:"Starting to notice the absence. The city looks different without it.",
    effects:{hustle:-1},
  },
  {min:40, max:59, name:"Hooked",    icon:"◑", color:"#f4a261", desc:"Part of the routine. You tell yourself you could stop.",
    effects:{hustle:-1,charm:-1,energyDrain:5},
  },
  {min:60, max:79, name:"Dependent", icon:"◕", color:"#e76f51", desc:"Can't function right without it. The body insists.",
    effects:{hustle:-2,charm:-2,toughness:-1,energyDrain:10,hungerDrain:10},
  },
  {min:80, max:94, name:"Consumed",  icon:"●", color:"#e63946", desc:"It runs your day. Not you. Everything else is logistics.",
    effects:{hustle:-3,charm:-3,toughness:-2,streetiq:-1,energyDrain:15,hungerDrain:15,heatRisk:true},
  },
  {min:95, max:100,name:"Destroyed", icon:"☠", color:"#9d0208", desc:"Rock bottom. You know it. Part of you doesn't care anymore.",
    effects:{hustle:-4,charm:-4,toughness:-3,streetiq:-2,energyDrain:20,hungerDrain:20,heatRisk:true,random_spend:true},
  },
];
// Recovery NPC — Carmen, appears when addiction >= 80
const CARMEN_DIALOGUE = [
  {rep:0, line:"I run a drop-in center on 3rd. You don't have to be ready. You just have to show up."},
  {rep:1, line:"Second day. You came back. That's more than most people manage."},
  {rep:2, line:"The shaking will stop. It takes longer than anyone tells you. But it stops."},
  {rep:3, line:"You're doing something most people never do. I mean that."},
  {rep:4, line:"Recovery isn't a straight line. Yesterday doesn't erase today. Today counts."},
  {rep:5, line:"I've been where you are. Different substance. Same math. You can come back from this."},
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
// ── ARCHETYPE STORYLINES ──────────────────────────────────────────────────────
// Each class has a 5-chapter story. Chapters unlock by completing tasks.
// STORY command shows progress. STORY NEXT advances when conditions are met.
// Unique bosses drop class-specific gear on defeat.
const CLASS_STORIES = {
  veteran: {
    title:"WHAT THE WAR TOOK",
    chapters:[
      { id:"v1", title:"Back on the Block",      lvlReq:1,
        task:"You were somebody once. Prove you still are. Win 3 fights.",
        condition:(gs)=>(gs.storyKills||0)>=3,
        reward:{cash:80,xp:200},
        story:`Three tours. Two medals. One dishonorable discharge they keep off your record. You haven't thrown a punch since you got back. Time to remember.`,
        complete:`Your hands still know what to do. Some things don't leave.`},
      { id:"v2", title:"The Handler",             lvlReq:3,
        task:"A VA contact has gone quiet. Find him. TALK GRAYSON in Manhattan.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_grayson"),
        reward:{cash:150,xp:350,item:"t_vest"},
        story:`Grayson ran psych intake at the VA. You heard he's living rough in Midtown. Something went wrong on the inside.`,
        complete:`He's still alive. Barely. He gives you the vest off his back and tells you something you needed to know.`},
      { id:"v3", title:"Old Debts",               lvlReq:5,
        task:"Someone who owed you found you first. Defeat PRICE in Brooklyn.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_price"),
        boss:{id:"price", name:"Price", icon:"🎖", hp:70, attackBonus:6, desc:"Former unit member. Made choices you didn't. Now he's made one more."},
        reward:{cash:200,xp:500},
        story:`Price. You served with him for two years. He sold something he shouldn't have. To someone he shouldn't have. And now he's found you.`,
        complete:`He's breathing. You left him that. You're not sure why.`},
      { id:"v4", title:"The Mission",             lvlReq:7,
        task:"Protect a corner for 5 consecutive days without losing it.",
        condition:(gs)=>(gs.storyHeldCorner||0)>=5,
        reward:{cash:300,xp:700,skill:"street_medic"},
        story:`You know how to hold a position. You just forgot you could do it for yourself.`,
        complete:`Five days. Nobody took it. That's longer than some deployments.`},
      { id:"v5", title:"The Colonel",             lvlReq:10,
        task:"The man who signed your discharge is in Manhattan. End it. Defeat THE COLONEL.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_colonel"),
        boss:{id:"colonel", name:"The Colonel", icon:"🪖", hp:120, attackBonus:10, desc:"He destroyed your file. He thought that would be enough."},
        reward:{cash:500,xp:1000,title:"The Veteran"},
        story:`He's running a consulting firm now. Security contracts. Untouchable. Except he's not.`,
        complete:`You didn't kill him. You made sure he knew you could have. That's enough.`},
    ]},
  hustler: {
    title:"THE LONG GAME",
    chapters:[
      { id:"h1", title:"Seed Money",              lvlReq:1,
        task:"Stack $500 from hustle alone (no corners, no quests).",
        condition:(gs)=>(gs.storyHustleCash||0)>=500,
        reward:{cash:100,xp:200},
        story:`Every empire starts with something. You have $${0}. Make it something.`,
        complete:`$500. People think that's nothing. You know it's everything.`},
      { id:"h2", title:"The Mark",                lvlReq:3,
        task:"Run the same borough 3 days straight. Establish presence.",
        condition:(gs)=>(gs.storyBoroDays||0)>=3,
        reward:{cash:200,xp:350},
        story:`You need a territory. Pick one. Work it until it knows your face.`,
        complete:`They see you coming now. That's either respect or a target. You'll take either.`},
      { id:"h3", title:"Rivals",                  lvlReq:5,
        task:"Outbid FELIX on the Queens black market. Buy before he does for 3 days.",
        condition:(gs)=>(gs.storyFlags||[]).includes("outbid_felix"),
        boss:{id:"felix", name:"Felix", icon:"💵", hp:50, attackBonus:4, desc:"Another hustler. Better connected. More ruthless. So far."},
        reward:{cash:300,xp:500,item:"t_scanner"},
        story:`Felix runs the Queens arbitrage. Has for four years. He's about to have competition.`,
        complete:`Felix makes an offer. You decline. Some things aren't for sale.`},
      { id:"h4", title:"The Deal",                lvlReq:7,
        task:"Complete 5 trade offers with other players.",
        condition:(gs)=>(gs.storyTradesDone||0)>=5,
        reward:{cash:400,xp:700},
        story:`Money alone isn't power. A network is power. Build one.`,
        complete:`Five deals. Five people who now owe you something. That's how it works.`},
      { id:"h5", title:"The Seat at the Table",   lvlReq:10,
        task:"Own corners in 3 boroughs simultaneously and defeat THE BROKER.",
        condition:(gs)=>(gs.cornersOwned||[]).length>=3&&(gs.storyFlags||[]).includes("defeated_broker"),
        boss:{id:"broker", name:"The Broker", icon:"🃏", hp:100, attackBonus:8, desc:"He controls the city's informal economy. He's not pleased to see competition."},
        reward:{cash:800,xp:1000,title:"The Hustler"},
        story:`Three boroughs. One name everyone knows. All that's left is the man who thinks he runs it all.`,
        complete:`He offers you a partnership. You take his corner instead.`},
    ]},
  junkie: {
    title:"WHAT'S LEFT",
    chapters:[
      { id:"j1", title:"The Usual",               lvlReq:1,
        task:"Survive 5 days without dying from withdrawal.",
        condition:(gs)=>gs.day>=5&&(gs.storyFlags||[]).includes("survived_withdrawal"),
        reward:{cash:60,xp:200,item:"t_burner"},
        story:`Every day is a negotiation with your body. Today it's winning. Try anyway.`,
        complete:`Five days. The withdrawal tried. You're still here.`},
      { id:"j2", title:"The Connection",          lvlReq:3,
        task:"Find DEJA in the Bronx. She has information. TALK DEJA.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_deja"),
        reward:{cash:100,xp:350},
        story:`You heard there's a woman in the Bronx who knows where the next shipment comes from. And who's cutting it.`,
        complete:`Deja knows things. She charges for them. You pay in the only currency that matters out here.`},
      { id:"j3", title:"The Dealer",              lvlReq:5,
        task:"Defeat SKINNY in Brooklyn. He's been watering down the product.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_skinny"),
        boss:{id:"skinny", name:"Skinny", icon:"💉", hp:45, attackBonus:3, desc:"Small man. Big operation. He's been killing people slowly for two years."},
        reward:{cash:200,xp:500},
        story:`People have been getting sick. You know why. Skinny's been cutting with something that shouldn't be cut.`,
        complete:`Skinny won't be cutting anything again. Not the same way.`},
      { id:"j4", title:"The Notebook",            lvlReq:7,
        task:"Decode 3 coded messages found in SEARCH. Your streetiq reveals patterns others miss.",
        condition:(gs)=>(gs.storyDecoded||0)>=3,
        reward:{cash:250,xp:700,item:"t_tool"},
        story:`You've been carrying a notebook full of street patterns nobody else sees. There's something in it. Something big.`,
        complete:`It's a map. Of sorts. Of everything that moves through this city and who it belongs to.`},
      { id:"j5", title:"The Source",              lvlReq:10,
        task:"Trace the supply chain to the top. Defeat THE CHEMIST in Manhattan.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_chemist"),
        boss:{id:"chemist", name:"The Chemist", icon:"⚗️", hp:90, attackBonus:7, desc:"The one at the top of it. PhD. Clean record. Responsible for thousands."},
        reward:{cash:600,xp:1000,title:"The Survivor"},
        story:`Nobody believes someone like you found what the DEA couldn't. That's what made it possible.`,
        complete:`You have enough to end careers. What you do with it is up to you.`},
    ]},
  ghost: {
    title:"DISAPPEAR",
    chapters:[
      { id:"g1", title:"No Trace",               lvlReq:1,
        task:"Complete 5 SCOUT actions without triggering heat.",
        condition:(gs)=>(gs.storyScouts||0)>=5,
        reward:{cash:70,xp:200},
        story:`Everybody leaves tracks. You stopped doing that years ago.`,
        complete:`Five scouts. No heat. No witnesses. Good.`},
      { id:"g2", title:"The Tail",               lvlReq:3,
        task:"You're being followed. Lose them by moving through 4 boroughs in one day.",
        condition:(gs)=>(gs.storyFlags||[]).includes("lost_tail"),
        reward:{cash:120,xp:350,item:"t_hood"},
        story:`You noticed it this morning. Someone's tracking your pattern. Time to show them you don't have one.`,
        complete:`Four boroughs, three subway changes, two clothing swaps. They stopped following somewhere in Queens.`},
      { id:"g3", title:"The Witness",            lvlReq:5,
        task:"Someone saw something they shouldn't. Find and TALK WITNESS before ECHO does.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_witness"),
        boss:{id:"echo", name:"Echo", icon:"🌫", hp:60, attackBonus:5, desc:"Another ghost. Works for the other side. Faster than you, maybe."},
        reward:{cash:250,xp:500},
        story:`The witness is scared. Echo is already looking. You both want the same person. For different reasons.`,
        complete:`You got there first. The witness is somewhere safe. Echo is not pleased.`},
      { id:"g4", title:"The File",               lvlReq:7,
        task:"Find your own file. SEARCH in Manhattan 10 times — it's in a government building.",
        condition:(gs)=>(gs.storyManhattanSearches||0)>=10,
        reward:{cash:300,xp:700},
        story:`You shouldn't exist on paper. But you do. One file, one agency, one person who knows your real name.`,
        complete:`You found it. You read it. You burned what you could and memorized the rest.`},
      { id:"g5", title:"The Handler",            lvlReq:10,
        task:"Confront THE HANDLER. Defeat him in Staten Island.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_handler"),
        boss:{id:"handler", name:"The Handler", icon:"🕴", hp:110, attackBonus:9, desc:"The one who made you disappear in the first place."},
        reward:{cash:500,xp:1000,title:"The Ghost"},
        story:`The person who burned your life to the ground is still out there. Living well. Assuming you're gone.`,
        complete:`He assumed wrong.`},
    ]},
  vampire: {
    title:"BLOOD AND CONCRETE",
    chapters:[
      { id:"vp1", title:"Old Hunger",            lvlReq:1,
        task:"FEED on 3 different targets.",
        condition:(gs)=>(gs.feedCount||0)>=3,
        reward:{cash:0,xp:250,item:"t_balaclava"},
        story:`The city makes feeding easy. Too many people nobody will miss. You've gotten lazy. Get precise.`,
        complete:`Three different feeds. Three different faces. The hunger doesn't go away. It never does.`},
      { id:"vp2", title:"The Coven",             lvlReq:3,
        task:"You're not alone. Find MIRA in Manhattan at night. TALK MIRA.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_mira"),
        reward:{cash:0,xp:400,item:"t_coat"},
        story:`There's another one out here. You've smelled it for weeks. Mira is old. Older than you. She's surviving differently.`,
        complete:`Mira doesn't trust you. That's appropriate. She gives you something anyway.`},
      { id:"vp3", title:"The Hunter",            lvlReq:5,
        task:"Defeat BROTHER THOMAS — he knows what you are.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_thomas"),
        boss:{id:"thomas", name:"Brother Thomas", icon:"✝️", hp:80, attackBonus:8, desc:"He's been hunting for thirty years. Knows all the old tricks. Has some of his own."},
        reward:{xp:600,item:"t_piece"},
        story:`Someone's been leaving stakes in your usual spots. Leaving silver shavings. He's old-school. Effective.`,
        complete:`Thomas is alive. Because you let him live. He'll be back. So will you.`},
      { id:"vp4", title:"The Bloodline",         lvlReq:7,
        task:"Mesmerize 5 targets and keep at least 2 as thralls simultaneously.",
        condition:(gs)=>(gs.mesmerizeCount||0)>=5&&(gs.thralls||[]).length>=2,
        reward:{xp:800},
        story:`Power isn't just the feed. It's the network you build around you.`,
        complete:`Two minds you can reach into from across the borough. You're remembering what you were.`},
      { id:"vp5", title:"The Ancient",           lvlReq:10,
        task:"Defeat THE ANCIENT in the Bronx — the one who's been here since before the bridges.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_ancient"),
        boss:{id:"ancient", name:"The Ancient", icon:"🧛", hp:150, attackBonus:12, desc:"Before the city was a city. Before the borough was a borough. Territorial. Furious."},
        reward:{xp:1000,title:"The Undying"},
        story:`The city belongs to the old ones first. You want it. They've been here longer.`,
        complete:`Older. Stronger. But slow. Time does that even to things that don't age.`},
    ]},
  rat: {
    title:"BOTH SIDES",
    chapters:[
      { id:"r1", title:"First Burn",             lvlReq:1,
        task:"INFORM on 3 players to your handler.",
        condition:(gs)=>(gs.informCount||0)>=3,
        reward:{cash:150,xp:200},
        story:`The handler is patient. They always are. They've been watching you watch everyone else.`,
        complete:`Three tips. Three people who don't know it yet. The handler is pleased.`},
      { id:"r2", title:"Cover Story",            lvlReq:3,
        task:"Build rep with 2 different NPCs while informing. Nobody can know.",
        condition:(gs)=>(gs.storyFlags||[]).includes("dual_cover"),
        reward:{cash:200,xp:400},
        story:`The best lies are built on truth. Be genuinely useful to people while using them.`,
        complete:`They trust you. Both of them. That's the worst part.`},
      { id:"r3", title:"The Mole",               lvlReq:5,
        task:"Someone in the city is also an informant. Find ZERO before Zero finds you. TALK ZERO.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_zero"),
        boss:{id:"zero", name:"Zero", icon:"🐀", hp:55, attackBonus:5, desc:"Playing the same game. But their handler is different. And their target might be you."},
        reward:{cash:300,xp:600},
        story:`Your handler tells you there's another rat in the city. Working for the other side. Find them first.`,
        complete:`Zero was good. Just not as good. You let the handler know. Or maybe you don't.`},
      { id:"r4", title:"Exposed",                lvlReq:7,
        task:"Your cover is partially blown. Survive 7 days with heat 5+ without getting arrested.",
        condition:(gs)=>gs.day>=(gs.exposedDay||9999)+7&&(gs.storyFlags||[]).includes("exposed"),
        reward:{cash:250,xp:700,item:"t_balaclava"},
        story:`Someone figured it out. Not all the way. But enough. You need to survive the heat while your handler builds you a new cover.`,
        complete:`Seven days hot. Nobody made a move. Either they don't know enough, or they're waiting.`},
      { id:"r5", title:"The Flip",               lvlReq:10,
        task:"Turn the tables. Expose THE HANDLER's boss. Defeat DIRECTOR VALE.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_vale"),
        boss:{id:"vale", name:"Director Vale", icon:"🕴", hp:100, attackBonus:9, desc:"The man behind the handler. Comfortable. Insulated. Used to being untouchable."},
        reward:{cash:600,xp:1000,title:"The Double"},
        story:`You've been playing their game. Time to change the rules.`,
        complete:`The handler is panicking. Vale is indicted. You're free. For now.`},
    ]},
  fixer: {
    title:"THE NETWORK",
    chapters:[
      { id:"f1", title:"First Contact",          lvlReq:1,
        task:"TALK to every NPC in your borough in one day.",
        condition:(gs)=>(gs.storyFlags||[]).includes("met_all_npcs"),
        reward:{cash:100,xp:200},
        story:`A fixer is only as good as their contacts. Start building.`,
        complete:`You know their names. Their needs. Their prices. That's the foundation.`},
      { id:"f2", title:"The Wire",               lvlReq:3,
        task:"WIRE cash to 3 different players.",
        condition:(gs)=>(gs.storyWires||0)>=3,
        reward:{cash:150,xp:400},
        story:`Money moves through you. That's power. Learn to use it.`,
        complete:`Three transfers. The city is starting to understand what you are.`},
      { id:"f3", title:"The Dispute",            lvlReq:5,
        task:"Broker a deal between two rival crews. BROKER command.",
        condition:(gs)=>(gs.storyFlags||[]).includes("brokered_deal"),
        boss:{id:"kingmaker", name:"The Kingmaker", icon:"🔧", hp:65, attackBonus:5, desc:"Doesn't like competition in the deal-making space. Will make that clear."},
        reward:{cash:300,xp:600},
        story:`Two crews about to go to war over a corner. You can stop it. For a price.`,
        complete:`No war. Your commission. The Kingmaker doesn't like that you exist.`},
      { id:"f4", title:"Clean Money",            lvlReq:7,
        task:"Clean $500 for other players using CLEAN command.",
        condition:(gs)=>(gs.storyCleanedCash||0)>=500,
        reward:{cash:200,xp:700},
        story:`Dirty money is just clean money waiting for a fixer.`,
        complete:`$500 through the wash. Fees collected. Reputation built.`},
      { id:"f5", title:"The Commission",         lvlReq:10,
        task:"Defeat THE COLLECTOR — he's been skimming your network.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_collector"),
        boss:{id:"collector", name:"The Collector", icon:"🔑", hp:105, attackBonus:8, desc:"Takes cuts from fixers. Has been for years. Considers it a tax."},
        reward:{cash:700,xp:1000,title:"The Fixer"},
        story:`Someone has been taking 5% of everything you move. You just figured out who.`,
        complete:`The tax is gone. The Collector's operation is yours now, if you want it.`},
    ]},
  hooker: {
    title:"THE STROLL",
    chapters:[
      { id:"k1", title:"The Block",              lvlReq:1,
        task:"Use CLIENT command 5 times.",
        condition:(gs)=>(gs.clientCount||0)>=5,
        reward:{cash:100,xp:200},
        story:`You know how this works. You've always known. The block has its own rules. Learn them.`,
        complete:`Five clients. You're learning who to trust and who to watch.`},
      { id:"k2", title:"The Regular",            lvlReq:3,
        task:"Build 3 regulars through repeat CLIENT interactions.",
        condition:(gs)=>(gs.regulars||[]).length>=3,
        reward:{cash:200,xp:400,item:"t_jewelry"},
        story:`Regulars are stability. Stability is survival. Build the book.`,
        complete:`Three names. Three schedules. Three people who come back. That's security.`},
      { id:"k3", title:"The Stroll Boss",        lvlReq:5,
        task:"Defeat MARQUISE — he's been taxing the block.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_marquise"),
        boss:{id:"marquise", name:"Marquise", icon:"💄", hp:70, attackBonus:6, desc:"Runs the stroll. Takes 40%. Has for six years. Not interested in negotiation."},
        reward:{cash:300,xp:600},
        story:`Every stroll has a boss. Marquise has been taking too much for too long.`,
        complete:`Marquise made an offer. You told him what the new rate was. He disagreed. Now he agrees.`},
      { id:"k4", title:"The Cop",                lvlReq:7,
        task:"Survive 5 police encounters without getting arrested.",
        condition:(gs)=>(gs.storyCopEscapes||0)>=5,
        reward:{cash:250,xp:700,item:"t_kicks"},
        story:`The vice detective is new. Has a point to prove. Has specifically noticed you.`,
        complete:`Five close calls. You're still free. The detective is getting frustrated.`},
      { id:"k5", title:"The Exit",               lvlReq:10,
        task:"Get enough money to leave the stroll. $2000 saved. Defeat THE PIMP who won't let you.",
        condition:(gs)=>gs.cash>=2000&&(gs.storyFlags||[]).includes("defeated_pimp"),
        boss:{id:"pimp", name:"Sweet Reggie", icon:"🎩", hp:90, attackBonus:8, desc:"Thinks he owns you. Has for years. Is about to find out otherwise."},
        reward:{cash:500,xp:1000,title:"The Stroller"},
        story:`You've always known this was temporary. Today it ends.`,
        complete:`Reggie learned something. You leave the stroll the same way you do everything — on your own terms.`},
    ]},
  schizo: {
    title:"THE SIGNAL",
    chapters:[
      { id:"s1", title:"The Message",            lvlReq:1,
        task:"LOOK 10 times — the visions are telling you something.",
        condition:(gs)=>(gs.lookCount||0)>=10,
        reward:{cash:50,xp:250},
        story:`The city has been trying to reach you. Most people can't hear it. You can. Listen.`,
        complete:`Something is forming. In the patterns. In the cracks in the sidewalk. In the pigeons.`},
      { id:"s2", title:"The Map",                lvlReq:3,
        task:"Visit all 5 boroughs. The signal gets clearer with each one.",
        condition:(gs)=>(gs.borosVisited||[]).length>=5,
        reward:{cash:80,xp:400,item:"t_cap"},
        story:`The pattern spans the whole city. You need to see all of it.`,
        complete:`Five boroughs. The signal is loud now. You've drawn something on your manifesto pages that doesn't make sense yet.`},
      { id:"s3", title:"The Interference",       lvlReq:5,
        task:"Defeat DR. MORROW — he's been jamming the frequency.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_morrow"),
        boss:{id:"morrow", name:"Dr. Morrow", icon:"🌀", hp:60, attackBonus:4, desc:"Psychiatrist. Running a study. The study is about you specifically."},
        reward:{cash:150,xp:600},
        story:`Dr. Morrow has been prescribing something to the population in this borough. You can see the effect. Nobody else can.`,
        complete:`Morrow's study is over. The frequency is clearer. The map makes a little more sense.`},
      { id:"s4", title:"The Other One",          lvlReq:7,
        task:"Find CASSANDRA in Queens. She hears the signal too. TALK CASSANDRA.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_cassandra"),
        reward:{xp:800,item:"t_hood"},
        story:`You're not the only one. Somewhere in Queens there's a woman who's been following the same signal for years.`,
        complete:`Cassandra has a different map. When you put them together, something becomes clear.`},
      { id:"s5", title:"The Source",             lvlReq:10,
        task:"Find what's generating the signal. Defeat THE SIGNAL in the Bronx.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_signal"),
        boss:{id:"signal", name:"The Signal", icon:"📡", hp:80, attackBonus:6, desc:"Not what you expected. Nothing like what you expected."},
        reward:{cash:400,xp:1000,title:"The Prophet"},
        story:`The signal leads somewhere. You've always known it would.`,
        complete:`You found it. What it means — you're still working on that.`},
    ]},
  drifter: {
    title:"YOU AND THE DOG",
    chapters:[
      { id:"d1", title:"Find Food",              lvlReq:1,
        task:"PANHANDLE 5 times. The dog makes people generous.",
        condition:(gs)=>(gs.panhandleCount||0)>=5,
        reward:{cash:60,xp:200},
        story:`You and the dog. The dog is the reason people stop. Use that carefully.`,
        complete:`Five stops. The dog got most of the credit. You're fine with that.`},
      { id:"d2", title:"The Shelter That Won't",lvlReq:3,
        task:"Find a place that takes the dog. SHELTER 3 times without separating.",
        condition:(gs)=>(gs.storyDogShelters||0)>=3,
        reward:{cash:80,xp:400,item:"t_boots"},
        story:`Every shelter says no dogs. You're not going anywhere without the dog.`,
        complete:`Three places that said yes. You remember them. You tell other people with dogs.`},
      { id:"d3", title:"The Dogcatcher",        lvlReq:5,
        task:"Defeat the ANIMAL CONTROL OFFICER who's been targeting strays.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_dogcatcher"),
        boss:{id:"dogcatcher", name:"Officer Reyes (Animal Control)", icon:"🐕", hp:55, attackBonus:4, desc:"Following orders. Has taken three dogs this week. Won't take yours."},
        reward:{cash:150,xp:600,item:"t_gloves"},
        story:`Officer Reyes has been picking up dogs in your territory. Three gone this week. The dog knows. You know.`,
        complete:`Reyes won't be working this route anymore. The dog seems to understand what happened.`},
      { id:"d4", title:"The Pack",              lvlReq:7,
        task:"Help 3 other drifters. TALK to homeless NPCs in different boroughs.",
        condition:(gs)=>(gs.storyHelpedDrifters||0)>=3,
        reward:{cash:100,xp:700},
        story:`You're not the only one out here. The dog knows that too. She's been leading you to them.`,
        complete:`Three people. The dog greeted all of them the same way. Like she knew.`},
      { id:"d5", title:"Home",                  lvlReq:10,
        task:"Find the dog's original owner. SEARCH Staten Island 15 times, then TALK ELEANOR.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_eleanor"),
        reward:{cash:300,xp:1000,title:"The Drifter"},
        story:`You found a tag in the dog's collar. Old. Faded. A name and an address in Staten Island.`,
        complete:`Eleanor is 74. She lost the dog two years ago. She thought she'd never see her again. She's crying. You are too, a little.`},
    ]},
  undocumented: {
    title:"INVISIBLE",
    chapters:[
      { id:"u1", title:"The Network",            lvlReq:1,
        task:"CONNECT 5 times to use your community network.",
        condition:(gs)=>(gs.connectCount||0)>=5,
        reward:{cash:70,xp:200},
        story:`Off the grid doesn't mean alone. There's a whole city within the city.`,
        complete:`Five connections. Five people who don't know your name and don't need to.`},
      { id:"u2", title:"The Document",           lvlReq:3,
        task:"Find someone who can help you. TALK IVAN in Queens.",
        condition:(gs)=>(gs.storyFlags||[]).includes("found_ivan"),
        reward:{cash:100,xp:400,item:"t_burner"},
        story:`You need something. A single piece of paper that changes everything. Ivan might know someone.`,
        complete:`Ivan knows someone who knows someone. That's how it always works. He gives you a number.`},
      { id:"u3", title:"ICE",                   lvlReq:5,
        task:"Defeat or escape AGENT MILLS who's been tracking your pattern.",
        condition:(gs)=>(gs.storyFlags||[]).includes("escaped_mills"),
        boss:{id:"mills", name:"Agent Mills", icon:"🌐", hp:65, attackBonus:6, desc:"Patient. Methodical. Has been building a case for eight months."},
        reward:{xp:600,item:"t_hood"},
        story:`You've been careful. Not careful enough. Mills has been watching.`,
        complete:`You disappeared so completely that Mills had to close the file. He'll reopen it. But not today.`},
      { id:"u4", title:"The Community",         lvlReq:7,
        task:"Help 5 other undocumented people in your borough. TALK anyone who is hiding.",
        condition:(gs)=>(gs.storyHelped||0)>=5,
        reward:{cash:150,xp:700},
        story:`You survived because people helped you. Pass it forward.`,
        complete:`Five people. Some of them will make it. That has to be enough.`},
      { id:"u5", title:"The Papers",            lvlReq:10,
        task:"Defeat THE FORGER who has what you need but won't give it up. Manhattan.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_forger"),
        boss:{id:"forger", name:"The Forger", icon:"📄", hp:95, attackBonus:7, desc:"Has what you need. Has had it for three years. Has been leveraging that."},
        reward:{cash:500,xp:1000,title:"The Invisible"},
        story:`After everything, it comes down to one man who holds the thing that changes your life.`,
        complete:`You have the papers. Three years of fear in a manila envelope. You open it in a bathroom somewhere and look at your own name.`},
    ]},
  schemer: {
    title:"THE CON",
    chapters:[
      { id:"sc1", title:"The Setup",             lvlReq:1,
        task:"Convince 3 NPCs to give you something for free through TALK.",
        condition:(gs)=>(gs.storyConvinced||0)>=3,
        reward:{cash:80,xp:200},
        story:`A good con starts with a good story. You've been telling stories your whole life.`,
        complete:`Three marks. Three different lies. Three wins. You're warming up.`},
      { id:"sc2", title:"The Long Game",         lvlReq:3,
        task:"Build rep 10 with any NPC through repeated TALK.",
        condition:(gs)=>Object.values(gs.rep||{}).some(r=>r>=10),
        reward:{cash:150,xp:400,item:"t_rings"},
        story:`Trust takes time to build. That's why it's worth so much when you cash it in.`,
        complete:`Ten rep. They'd do almost anything for you. Almost.`},
      { id:"sc3", title:"The Mark",              lvlReq:5,
        task:"Defeat THE MARK — the one who figured out your last con.",
        condition:(gs)=>(gs.storyFlags||[]).includes("defeated_mark"),
        boss:{id:"mark", name:"The Mark", icon:"🃏", hp:60, attackBonus:5, desc:"Angry. Embarrassed. Has resources. Has decided to make this personal."},
        reward:{cash:250,xp:600},
        story:`He figured it out three weeks later. That's actually impressive. Now he wants his money back.`,
        complete:`He doesn't get his money back. He does get a lesson about letting things go.`},
      { id:"sc4", title:"The Flip",              lvlReq:7,
        task:"Con the con. TALK CARNAHAN and turn his scheme against him.",
        condition:(gs)=>(gs.storyFlags||[]).includes("flipped_carnahan"),
        reward:{cash:400,xp:700},
        story:`Carnahan is running a scheme that's taking money from people who can't afford to lose it. He needs to meet someone better at this than him.`,
        complete:`Carnahan's scheme is now your scheme. He doesn't know that yet.`},
      { id:"sc5", title:"The Crown",             lvlReq:10,
        task:"Execute the final con — earn $1500 in one day using only TALK and trades.",
        condition:(gs)=>(gs.storyOneDayCash||0)>=1500,
        boss:{id:"kingspin", name:"The Kingpin's Accountant", icon:"🃏", hp:85, attackBonus:7, desc:"Knows numbers better than anyone. Doesn't know you."},
        reward:{cash:800,xp:1000,title:"The Schemer"},
        story:`The big one. The one you've been building toward. One day. One shot.`,
        complete:`$1500 in fourteen hours. Every mark thought they were winning. That's the point.`},
    ]},
};

// Get the current chapter for a player's archetype storyline
const getStoryChapter=(gs)=>{
  const arch=gs.archetype?.id||"veteran";
  const story=CLASS_STORIES[arch];
  if(!story)return null;
  const progress=gs.storyProgress||{};
  const completed=progress[arch]||[];
  return story.chapters.find(c=>!completed.includes(c.id))||null;
};

// Check if current chapter condition is met
const isChapterComplete=(gs,chapter)=>{
  if(!chapter)return false;
  try{return chapter.condition(gs);}catch(e){return false;}
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
  hooker:       6,   // client slots per day
};
// Diminishing returns multiplier by hustle number today
const HUSTLE_PAYOUT_MULT = [1.0, 0.7, 0.45, 0.25, 0.10];
// Borough cooldown — same borough twice in a row costs heat
const HUSTLE_SAME_BORO_HEAT = 2;
const DEMAND_DROP = 0.22;         // price drop per seller (aggressive)
const DEMAND_SPIKE = 0.25;        // price spike per day without supply

// ── CORNER SYSTEM ─────────────────────────────────────────────────────────────
const CORNER_BASE_INCOME = {
  manhattan: [80,120],
  bronx:     [45,70],
  brooklyn:  [50,75],
  queens:    [40,65],
  staten:    [20,35],
};
const CORNER_UPGRADE_COST  = [0, 150, 350, 700];
const CORNER_UPGRADE_MULT  = [1.0, 1.5, 2.2, 3.5];
const CORNER_HEAT_DRAIN = {
  manhattan: 0.3,
  bronx:     0.2,
  brooklyn:  0.15,
  queens:    0.15,
  staten:    0.1,
};
const CORNER_PRESENCE_DAYS = 2;

// Presence tiers — what rate does the corner earn at
const CORNER_TIERS = {
  HOT:       { name:"HOT",       mult:1.0, accrualCap:12, desc:"You were here. Full rate.",             icon:"🔥" },
  WARM:      { name:"WARM",      mult:0.6, accrualCap:10, desc:"Army holding it. 60% rate.",            icon:"🟡" },
  COLD:      { name:"COLD",      mult:0.1, accrualCap:6,  desc:"Going cold. 10% trickle, 3 days left.", icon:"❄️" },
  CONTESTED: { name:"CONTESTED", mult:0,   accrualCap:0,  desc:"Rivals are moving in. Act fast.",       icon:"⚔" },
  LOST:      { name:"LOST",      mult:0,   accrualCap:0,  desc:"Corner taken. You need to reclaim it.", icon:"☠" },
};

const getCornerTier=(bId, gs, world)=>{
  const lastVisit=world?.cornerLastVisit?.[gs.name+":"+bId]||0;
  const daysSince=(gs.day||1)-(lastVisit||0);
  const army=gs.army||[];
  const hasLt=army.some(u=>u.id==="lieutenant");
  const hasEnforcer=army.some(u=>u.id==="enforcer");
  const deployed=(gs.armyDeployedBoro||{})[bId];
  const armyHere=deployed&&(hasLt||hasEnforcer);
  const contestedDay=(world?.cornerContested||{})[bId];
  const owner=world?.corners?.[bId];
  if(owner&&owner!==gs.name)return CORNER_TIERS.LOST;
  if(contestedDay&&(gs.day-contestedDay)<=1)return CORNER_TIERS.CONTESTED;
  if(daysSince<=CORNER_PRESENCE_DAYS)return CORNER_TIERS.HOT;
  if(armyHere||hasLt)return CORNER_TIERS.WARM;
  if(daysSince<=CORNER_PRESENCE_DAYS+3)return CORNER_TIERS.COLD;
  return CORNER_TIERS.CONTESTED;
};

const getCornerIncome=(boroId, level=0, gs, world, tier=null)=>{
  const base=CORNER_BASE_INCOME[boroId]||[20,40];
  const mult=CORNER_UPGRADE_MULT[level]||1;
  // kingpin skill check deferred — hasSkill not available here
  // callers that need kingpin bonus should pass tier with adjusted mult
  const daily=Math.round(((base[0]+base[1])/2)*mult);
  const tierMult=tier?tier.mult:1.0;
  return Math.round(daily*tierMult);
};

// NPC rival crews that can contest cold corners
const NPC_RIVAL_CREWS = [
  {id:"los_primos",   name:"Los Primos",    icon:"🦅", boroughs:["bronx","manhattan"],       aggression:0.6, power:3},
  {id:"bedstuy_boys", name:"Bed-Stuy Boys", icon:"🔵", boroughs:["brooklyn"],                aggression:0.5, power:2},
  {id:"the_albanians",name:"The Albanians", icon:"🦁", boroughs:["staten","brooklyn"],       aggression:0.7, power:4},
  {id:"fifth_ave",    name:"Fifth Ave Crew",icon:"🎩", boroughs:["manhattan","queens"],      aggression:0.4, power:3},
  {id:"hunts_point",  name:"Hunts Point",   icon:"⚡", boroughs:["bronx","queens"],          aggression:0.8, power:5},
  {id:"flushing_red", name:"Flushing Red",  icon:"🔴", boroughs:["queens"],                  aggression:0.5, power:2},
];

// ── STREET ARMY SYSTEM ───────────────────────────────────────────────────────
const ARMY_UNITS = [
  { id:"lookout",   name:"Lookout",       icon:"👁",  cost:80,  upkeep:15, power:1, slots:1,
    desc:"Eyes on the block. Warns you when cops or rivals move in. Reduces bust chance 10%.",
    heatAdd:0.5, combatBonus:1, defenseBonus:2 },
  { id:"runner",    name:"Runner",        icon:"🏃",  cost:120, upkeep:20, power:2, slots:1,
    desc:"Moves product fast. +1 sell per day, reduces move heat.",
    heatAdd:0.7, combatBonus:1, defenseBonus:1, sellBonus:1 },
  { id:"enforcer",  name:"Enforcer",      icon:"🦾",  cost:200, upkeep:35, power:4, slots:2,
    desc:"Muscle. +4 to all fight rolls. Deters corner takeovers.",
    heatAdd:1.2, combatBonus:4, defenseBonus:5 },
  { id:"lieutenant",name:"Lieutenant",    icon:"⭐",  cost:400, upkeep:60, power:7, slots:3,
    desc:"Runs ops for you. Collects corner income even when cold. +6 fight, +8 defense.",
    heatAdd:2.0, combatBonus:6, defenseBonus:8, keepsCornersWarm:true },
  { id:"fixer_hire",name:"Street Fixer",  icon:"🔧",  cost:300, upkeep:45, power:3, slots:2,
    desc:"Handles dirty work. Reduces heat by 0.5/day passively.",
    heatAdd:-0.5, combatBonus:2, defenseBonus:3, heatReduce:0.5 },
];
const MAX_ARMY_SIZE = 8; // total slots
const getArmyPower=(army=[])=>army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.power||0);},0);
const getArmyUpkeep=(army=[])=>army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.upkeep||0);},0);
const getArmySlots=(army=[])=>army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.slots||0);},0);
const getArmyCombatBonus=(army=[])=>army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.combatBonus||0);},0);
const getArmyDefenseBonus=(army=[])=>army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.defenseBonus||0);},0);
const getArmyHeatMult=(army=[])=>{
  const totalHeat=army.reduce((s,u)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return s+(unit?.heatAdd||0);},0);
  return Math.max(0, totalHeat); // total passive heat per day from army size
}; // must visit within this many days or corner goes cold

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
  { id:"hooker", name:"THE HOOKER", icon:"💄", color:"#ff4d8d", desc:"You learned early that the city runs on transaction. You just cut out the middleman.", stats:{hustle:6,streetiq:8,toughness:4,charm:10,heat:4}, gear:["Good heels","Burner phone","Pepper spray"], xp:{talk:3,hustle:2},
    startCash:50, isHooker:true,
    special:"Highest charm stat in the game. CLIENT command replaces HUSTLE — higher yield, more risk. Regulars system builds over time. Cops are the real danger. The Stroll is a separate economy that operates in Manhattan and Queens at night." },
  { id:"schizo", name:"THE SCHIZO", icon:"🌀", color:"#c77dff", desc:"The city speaks to you. Nobody else can hear it.", stats:{hustle:7,streetiq:4,toughness:5,charm:6,heat:3}, gear:["Manifesto pages","Hospital bracelet","Lucky bottle cap"], xp:{hustle:1,fight:1,look:2}, startCash:25, isSchizo:true, special:"CHAOS CLASS. Every action has a 20% chance to go sideways — good or bad, you never know. Visions replace LOOK. Mental health works in reverse at Shattered — breakdown becomes breakthrough." },
  { id:"drifter", name:"GUY WITH DOG", icon:"🐕", color:"#c9a96e", desc:"You and your dog. The city can't take what you don't have.", stats:{hustle:5,streetiq:6,toughness:6,charm:9,heat:0}, gear:["Leash & collar","Cardboard sign","Sleeping bag"], xp:{panhandle:3,talk:2},
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
  clear:    { id:"clear",    icon:"☀️",  name:"Clear",        warmthDrain:1,  bustMult:1.0, movePenalty:0, desc:"Good day to work.",                          tempF:68 },
  cloudy:   { id:"cloudy",   icon:"☁️",  name:"Overcast",     warmthDrain:1.5,bustMult:0.9, movePenalty:0, desc:"Cops are lazy today.",                       tempF:58 },
  rain:     { id:"rain",     icon:"🌧",  name:"Rain",         warmthDrain:2.5,bustMult:0.8, movePenalty:0, desc:"Rain keeps eyes indoors. Lower heat.",        tempF:52 },
  fog:      { id:"fog",      icon:"🌫",  name:"Fog",          warmthDrain:1.5,bustMult:0.6, movePenalty:0, desc:"Can't see 10 feet. Hard to get clocked.",     tempF:55 },
  blizzard: { id:"blizzard", icon:"❄️",  name:"Blizzard",     warmthDrain:5,  bustMult:0.5, movePenalty:15,desc:"Streets are empty. Warmth draining fast.",   tempF:18 },
  heatwave: { id:"heatwave", icon:"🔥",  name:"Heat Wave",    warmthDrain:0,  bustMult:1.4, movePenalty:0, desc:"Cops are everywhere. Everyone's on edge.",    tempF:97 },
  storm:    { id:"storm",    icon:"⛈",  name:"Thunderstorm", warmthDrain:3,  bustMult:0.7, movePenalty:5, desc:"Heavy rain. Nobody's watching the corners.",  tempF:48 },
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
  rareEvent:    (gs,title)=>title==="The Incident"?`Day ${gs.day}. Coordinates: unknown. Duration: 11 seconds. Object: unclassified. Witness: one person. One dog. Nobody else saw it. This entry is factual.`:`Day ${gs.day}: ${title}. The city keeps throwing things at you.`,
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
  hooker:       ["charm","hustle","charm","streetiq","charm","toughness","hustle","charm","streetiq","hustle"],
  schizo:       ["hustle","streetiq","charm","toughness","hustle","streetiq","hustle","charm","streetiq","hustle"],
  drifter:      ["charm","hustle","charm","toughness","hustle","charm","streetiq","hustle","charm","toughness"],
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
  coffee_xl:  { name:"Large Coffee",    price:4,  desc:"Double cup. Night shift fuel.",        effect:{energy:35,mental:8}, addictive:false },
  soup:       { name:"Cup of Soup",     price:3,  desc:"Warm. Salt. Better than nothing.",     effect:{hunger:25,warmth:10}, addictive:false },
  metrocard:  { name:"MetroCard",       price:3,  desc:"Single ride. Gets you where you're going.", effect:{energy:0}, special:"transit", addictive:false },
  aspirin:    { name:"Aspirin",         price:3,  desc:"Dollar store bottle. Takes the edge off pain.", effect:{health:10,mental:5}, addictive:false },
  energydrink:{ name:"Energy Drink",    price:3,  desc:"It'll work. For a few hours.",         effect:{energy:40,health:-5}, addictive:false },
  hotdog:     { name:"Hot Dog",         price:2,  desc:"Street cart. Mustard. You know what you're getting.", effect:{hunger:20}, addictive:false },
  bandage:    { name:"Street Bandage",  price:8,  desc:"Gauze and tape from the corner store. +25 health.", effect:{health:25}, addictive:false },
  neosporin:  { name:"First Aid Kit",   price:15, desc:"Actual kit. Stops the bleeding properly. +40 health.", effect:{health:40}, addictive:false },
  fortywine:  { name:"Thunderbird",     price:3,  desc:"Cheap wine. Numbs things. +mental, -health long term.", effect:{mental:20,warmth:15,health:-5}, addictive:true, substance:"alcohol" },
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
  // More finds — gear, consumables, rare discoveries
  {type:"gear",    desc:"Gym bag behind the locker room. Nobody claimed it. Inside: wrapped up tight, clearly someone's backup.", item:"Brass Knuckles", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Abandoned camp under the BQE. Sleeping bag, a canned good, and something wrapped in a shirt.", item:"Army Jacket", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Donation box outside a church. Someone dropped a coat with a flask still in the inside pocket.", item:"Hip Flask", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Dumpster behind a pawn shop. Merchandise that didn't sell. You find the watch first.", item:"Pawn Shop Watch", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Maintenance tunnel behind the train yard. Old army surplus box, sealed. Half the contents are usable.", item:"Army Ration", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Corner of an abandoned building. Someone lived here. Left in a hurry. Left a crowbar.", item:"Crowbar", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Street festival cleanup crew walked past a case. You didn't.", item:"Street Taser", value:null, rarity:"rare", prob:0.2},
  {type:"gear",    desc:"Transit workers' supply closet, propped open. Old MetroCard in a drawer. You pocket it quietly.", item:"Old MetroCard", value:null, rarity:"common"},
  {type:"gear",    desc:"Construction site dumpster. Thermal liner, factory-sealed, wrong size for whoever ordered it. Right size for you.", item:"Thermal Base Layer", value:null, rarity:"uncommon"},
  {type:"gear",    desc:"Coin on the sidewalk. Then another. Then you see it's a trail leading to a storm drain. At the bottom: a coin someone carried for years.", item:"Lucky Coin", value:null, rarity:"rare", prob:0.15},
  {type:"consumable",desc:"First aid kit zip-tied to a construction fence. Red cross faded. Contents mostly intact.", item:"Street Bandage", value:null, rarity:"common"},
  {type:"consumable",desc:"Takeout bag outside a clinic side door. Hot meal inside, untouched. Still warm.", item:"Hot Meal (Container)", value:null, rarity:"common"},
  {type:"consumable",desc:"Pharmacy dumpster. Sealed packaging. Pain pills, expired by a month. You'll live.", item:"Pain Pills", value:null, rarity:"uncommon"},
  {type:"consumable",desc:"Roll of duct tape hanging off a broken fence. Three-quarters full. Good enough.", item:"Duct Tape", value:null, rarity:"common"},
  {type:"map",      desc:"Hand-drawn on a paper bag. Locations marked with x's. You count six marks. Three you recognize.", item:"Hand-Drawn Map", value:null, rarity:"rare", prob:0.12},
  {type:"nothing",  desc:"Someone's been through here. Recently. Boot prints in the wet ground, heading east.", value:null},
  {type:"nothing",  desc:"You find a folded note. It says: 'If you're reading this, you're looking in the wrong place.' No signature.", value:null},
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
  // Supply is tracked as boro_product_dayN — sum today's units sold
  const todayKey=`${bId}_${pKey}_d${day||1}`;
  const sellers=worldSupply?.[todayKey]||0;
  const daysWithout=worldSupply?.[`${bId}_${pKey}_drought`]||0;
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
const defWorld=()=>({corners:{},cornerLevels:{},cornerLastVisit:{},cornerDefending:{},cornerContested:{},cornerContestedBy:{},players:{},crews:{},messages:[],pvpLog:[],bounties:{},wallOfDead:[],playerAlerts:{},safehouses:{},weatherDay:0,weather:"clear",shelterCheckins:{},letters:[],worldHistory:[],notifications:[],copPresence:{},supply:{},captainBoro:null,captainDay:0,wantedTiers:{},contracts:[],contractsDay:0,wantedPosters:{},worldEvent:null,worldEventDay:0,tradeOffers:{},leaderboard:{},leaderboardWeek:0,offlineEvents:{},rivals:{}});

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
  schizo: [
    { id:"pattern_sense",  name:"Pattern Sense",  level:2, cost:1, desc:"LOOK reveals hidden intel others miss — cop locations, rival movements.", effect:{lookBonus:true}},
    { id:"chaos_theory",   name:"Chaos Theory",   level:3, cost:1, desc:"Combat random events favor you 60% of the time instead of 50%.",         effect:{chaosFavor:0.6}},
    { id:"the_signal",     name:"The Signal",     level:4, cost:2, desc:"SIGNAL command. Get a tip about the best money opportunity today.",       effect:{ability:"signal"}},
    { id:"breakdown",      name:"Breakthrough",   level:5, cost:1, desc:"When mental hits 0, gain +10 to all stats for 1 hour instead of dying.", effect:{breakdownBoost:true}},
    { id:"sixth_sense",    name:"Sixth Sense",    level:6, cost:2, desc:"Warned 1 turn before cop raids, PvP attacks, and rival pressure.",        effect:{earlyWarn:true}},
    { id:"prophet",        name:"Prophet",        level:7, cost:2, desc:"PROPHECY command. Predict market prices 2 days ahead with 70% accuracy.", effect:{ability:"prophecy"}},
    { id:"static",         name:"Static",         level:8, cost:2, desc:"Mental damage from withdrawal halved. Voices become white noise.",        effect:{withdrawalResist:0.5}},
    { id:"the_frequency",  name:"The Frequency",  level:9, cost:3, desc:"All LOOK and SEARCH finds doubled. The city speaks directly to you.",     effect:{scoutDouble:true}},
  ],
  drifter: [
    { id:"dog_sense",      name:"Dog Sense",      level:2, cost:1, desc:"Your dog warns you before attacks. Can't be sucker-punched.",             effect:{noSuckerPunch:true}},
    { id:"found_it",       name:"Found It",       level:3, cost:1, desc:"SEARCH finds items twice as often. The dog has a nose for things.",       effect:{searchBonus:2}},
    { id:"pack_bond",      name:"Pack Bond",      level:4, cost:2, desc:"Dog fights with you. +1d6 damage in combat. Auto-hits.",                  effect:{dogFight:true}},
    { id:"road_wisdom",    name:"Road Wisdom",    level:5, cost:1, desc:"Moving costs no energy. You've walked every borough a thousand times.",   effect:{freeMoves:true}},
    { id:"shelter_network",name:"Shelter Network",level:6, cost:2, desc:"SHELTER always succeeds and restores +20hp. Dog is always welcome.",      effect:{shelterBonus:20}},
    { id:"invisible_man",  name:"Invisible Man",  level:7, cost:2, desc:"Heat passively drops 0.5/day. Police don't look twice at drifters.",      effect:{heatDecay:0.5}},
    { id:"scavenger",      name:"Scavenger",      level:8, cost:2, desc:"SCAVENGE costs no energy and has no cooldown.",                           effect:{scavengeFree:true}},
    { id:"old_road",       name:"Old Road",       level:9, cost:3, desc:"Moving between boroughs drops heat -1. You know how to disappear.",       effect:{moveHeatDrop:1}},
  ],
  hooker: [
    { id:"read_em",        name:"Read Em",        level:2, cost:1, desc:"CLIENT command reveals how much they'll pay before you commit.",          effect:{clientPreview:true}},
    { id:"regular",        name:"Regular",        level:3, cost:1, desc:"Clients become regulars after 2 visits. Regulars pay +30%.",              effect:{regularBonus:0.3}},
    { id:"the_book",       name:"The Book",       level:4, cost:2, desc:"Maintain a client list. Up to 5 regulars each paying daily.",             effect:{clientBook:5}},
    { id:"network_effect", name:"Network Effect", level:5, cost:1, desc:"Regulars refer friends. CLIENT command available twice/day.",             effect:{clientDouble:true}},
    { id:"hush_money",     name:"Hush Money",     level:6, cost:2, desc:"Paying $30 to a regular reduces your heat by 2.",                        effect:{ability:"hush"}},
    { id:"the_stroll",     name:"The Stroll",     level:7, cost:2, desc:"Owning a corner in your boro doubles CLIENT income.",                     effect:{strollCornerMult:2}},
    { id:"untouchable_k",  name:"Connected",      level:8, cost:2, desc:"Three NPCs owe you. Call one favor/day — cash, heat drop, or intel.",     effect:{npcFavor:3}},
    { id:"madame",         name:"Madame",         level:9, cost:3, desc:"Hire 2 workers. Each earns $40/day. You manage the operation.",           effect:{madame:true}},
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
  // ── CONSUMABLES — single use, carried in inventory ─────────────────────────
  {id:"bandage",     name:"Street Bandage",     slot:"consumable", rarity:"common",   uses:1, stats:{}, effect:{heal:25},         desc:"Dirty but effective. +25 health when used."},
  {id:"adrenaline",  name:"Adrenaline Shot",    slot:"consumable", rarity:"rare",     uses:1, stats:{}, effect:{energy:60,fight:5},desc:"One hit of everything. USE in combat or before a fight."},
  {id:"pain_pills",  name:"Pain Pills",         slot:"consumable", rarity:"uncommon", uses:1, stats:{}, effect:{heal:15,pain:true},desc:"Takes the edge off. +15 health, ignore next hit penalty."},
  {id:"duct_tape",   name:"Duct Tape",          slot:"consumable", rarity:"common",   uses:3, stats:{}, effect:{repair:true},     desc:"Fixes almost anything. 3 uses."},
  {id:"lockpick_kit",name:"Lockpick Kit",       slot:"consumable", rarity:"uncommon", uses:2, stats:{}, effect:{unlock:true},     desc:"Opens doors. 2 uses. LOCKPICK to use."},
  {id:"disguise_kit",name:"Disguise Kit",       slot:"consumable", rarity:"rare",     uses:1, stats:{}, effect:{heatReset:3},     desc:"One-time heat drop -3. You become someone else briefly."},
  {id:"hot_meal",    name:"Hot Meal (Container)",slot:"consumable",rarity:"common",   uses:1, stats:{}, effect:{hunger:60,mental:15},desc:"Real food. The kind that reminds you what normal feels like."},
  // ── SCAVENGED / FOUND-ONLY ITEMS ──────────────────────────────────────────
  {id:"army_ration", name:"Army Ration",        slot:"consumable", rarity:"uncommon", uses:1, stats:{}, effect:{hunger:80,energy:20},desc:"Found in someone's old duffel. Still sealed. Not expired."},
  {id:"hip_flask",   name:"Hip Flask",          slot:"accessory",  rarity:"uncommon", stats:{mental:8,warmth:5,addiction:2},      desc:"Half full of something strong. Keeps the cold out."},
  {id:"old_watch",   name:"Pawn Shop Watch",    slot:"accessory",  rarity:"uncommon", stats:{charm:1,streetiq:1},                desc:"Stopped at 4:17. You don't know which day."},
  {id:"lucky_coin",  name:"Lucky Coin",         slot:"accessory",  rarity:"rare",     stats:{hustle:1,luck:2},                   desc:"You've kept it for a reason."},
  {id:"broken_radio",name:"Broken Radio",       slot:"accessory",  rarity:"common",   stats:{mental:5},                          desc:"Gets one station. Static mostly. Enough."},
  {id:"transit_card",name:"Old MetroCard",      slot:"accessory",  rarity:"common",   stats:{hustle:1},                          effect:{freeMove:true},desc:"Might have rides left. You won't know until you tap."},
  {id:"stash_map",   name:"Hand-Drawn Map",     slot:"accessory",  rarity:"rare",     stats:{streetiq:2},                        effect:{scoutBonus:true},desc:"Someone's stash locations. Not all of them are empty."},
  {id:"crow_bar",    name:"Crowbar",            slot:"weapon",     rarity:"uncommon", stats:{fightBonus:4,toughness:1},           desc:"Opens doors. Also heads."},
  {id:"spiked_bat",  name:"Spiked Bat",         slot:"weapon",     rarity:"rare",     stats:{fightBonus:6,toughness:1,heat:1},   desc:"You added the nails yourself."},
  {id:"taser",       name:"Street Taser",       slot:"weapon",     rarity:"rare",     stats:{fightBonus:3,stunChance:0.3},       desc:"Stun chance 30%. Charges limited."},
  {id:"bike_lock",   name:"Kryptonite Lock",    slot:"weapon",     rarity:"uncommon", stats:{fightBonus:3,toughness:1},          desc:"Swing first. Questions later."},
  {id:"night_goggles",name:"Night Vision Monocle",slot:"head",     rarity:"legendary",stats:{streetiq:3,heat:-2,bustReduction:0.15},desc:"Military surplus. Worth more than you."},
  {id:"thermal_base",name:"Thermal Base Layer", slot:"chest",      rarity:"uncommon", stats:{warmth:12,energy:5},                desc:"Layered under everything. Nobody knows it's there."},
  {id:"cargo_pants", name:"Cargo Pants",        slot:"feet",       rarity:"common",   stats:{hustle:1,carryBonus:5},             desc:"Pockets everywhere. Carry more."},
  {id:"steel_cap_boots",name:"Steel Cap Boots", slot:"feet",       rarity:"rare",     stats:{toughness:3,fightBonus:2,warmth:4},desc:"Heavy. Authoritative."},
  // ── OREGON TRAIL QUEST ITEMS ─────────────────────────────────────────────────
  {id:"alien_report",  name:"Alien Encounter Report", slot:"accessory",rarity:"legendary",stats:{charm:2,streetiq:3},desc:"Eleven seconds. You were there. Nobody believes you. You know.",quest:true},
  {id:"alien_footage", name:"Alien Footage",           slot:"accessory",rarity:"legendary",stats:{charm:5,hustle:2},desc:"You have footage of something nobody can explain. This is worth something to the right person.", quest:true},
  {id:"rope",        name:"Rope",                  slot:"accessory", rarity:"uncommon",  stats:{hustle:1},                     desc:"Heavy duty. Could hold a lot.", quest:true},
  {id:"wpbag",       name:"Waterproof Bag",         slot:"accessory", rarity:"rare",      stats:{},                             desc:"Keeps things dry. Crucial.", quest:true},
  {id:"raft_mat",    name:"Raft Materials",         slot:"accessory", rarity:"rare",      stats:{},                             desc:"Lashed together from whatever you could find. Probably fine.", quest:true},
  {id:"oregon_medal",name:"Oregon Trail Medal",     slot:"accessory", rarity:"legendary", stats:{charm:3,toughness:2,mental:20,hustle:2}, desc:"You forded the Hudson. Nobody believes you.", quest:true},
];

const getItemById=id=>{
  if(!id)return null;
  if(typeof id==="object"&&id._rolled)return id; // rolled item object
  return BASE_ITEMS.find(i=>i.id===id);
};

// ── LOOT TREADMILL — ITEM TEMPLATES & ROLL SYSTEM ─────────────────────────────
// Stat ranges per slot. Each stat is [min, max] — min 0 means it sometimes doesn't roll.
const ITEM_TEMPLATES = [
  // HEAD
  {id:"t_beanie",    name:"Beanie",          slot:"head",    weights:{common:60,uncommon:30,rare:8,legendary:2},
   statRanges:{warmth:[2,12],hustle:[0,2],streetiq:[0,1],heat:[0,-2]}},
  {id:"t_cap",       name:"Street Cap",       slot:"head",    weights:{common:40,uncommon:35,rare:20,legendary:5},
   statRanges:{charm:[0,3],heat:[0,-2],streetiq:[0,2]}},
  {id:"t_hood",      name:"Hood",             slot:"head",    weights:{common:50,uncommon:30,rare:15,legendary:5},
   statRanges:{heat:[0,-3],hustle:[0,2],streetiq:[0,1]}},
  {id:"t_balaclava", name:"Balaclava",        slot:"head",    weights:{common:10,uncommon:40,rare:35,legendary:15},
   statRanges:{heat:[-1,-4],toughness:[0,2],streetiq:[0,2],bustReduction:[0,0.15]}},
  // CHEST
  {id:"t_hoodie",    name:"Hoodie",           slot:"chest",   weights:{common:50,uncommon:35,rare:12,legendary:3},
   statRanges:{warmth:[3,12],heat:[0,-2],toughness:[0,2]}},
  {id:"t_jacket",    name:"Jacket",           slot:"chest",   weights:{common:20,uncommon:40,rare:30,legendary:10},
   statRanges:{toughness:[1,4],warmth:[3,15],charm:[0,3],heat:[0,-2]}},
  {id:"t_vest",      name:"Vest",             slot:"chest",   weights:{common:5,uncommon:20,rare:45,legendary:30},
   statRanges:{toughness:[2,5],noOneShot:[0,1],warmth:[0,8],fightBonus:[0,2]}},
  {id:"t_coat",      name:"Coat",             slot:"chest",   weights:{common:20,uncommon:35,rare:30,legendary:15},
   statRanges:{warmth:[5,18],charm:[0,3],heat:[0,-2],toughness:[0,2]}},
  // HANDS
  {id:"t_gloves",    name:"Gloves",           slot:"hands",   weights:{common:50,uncommon:35,rare:12,legendary:3},
   statRanges:{warmth:[2,10],toughness:[0,2],fightBonus:[0,2],bustReduction:[0,0.08]}},
  {id:"t_knuckles",  name:"Knuckles",         slot:"hands",   weights:{common:15,uncommon:40,rare:35,legendary:10},
   statRanges:{fightBonus:[2,6],toughness:[0,3],intimidate:[0,1]}},
  {id:"t_rings",     name:"Rings",            slot:"hands",   weights:{common:20,uncommon:40,rare:30,legendary:10},
   statRanges:{charm:[1,4],fightBonus:[0,3],hustle:[0,2]}},
  // FEET
  {id:"t_sneakers",  name:"Sneakers",         slot:"feet",    weights:{common:40,uncommon:35,rare:18,legendary:7},
   statRanges:{hustle:[0,3],charm:[0,2],energy:[0,8]}},
  {id:"t_boots",     name:"Boots",            slot:"feet",    weights:{common:35,uncommon:40,rare:20,legendary:5},
   statRanges:{toughness:[1,4],warmth:[3,12],fightBonus:[0,2]}},
  {id:"t_kicks",     name:"Kicks",            slot:"feet",    weights:{common:20,uncommon:40,rare:30,legendary:10},
   statRanges:{hustle:[1,3],charm:[1,4],heat:[0,-1]}},
  // WEAPON
  {id:"t_blade",     name:"Blade",            slot:"weapon",  weights:{common:30,uncommon:40,rare:22,legendary:8},
   statRanges:{fightBonus:[2,7],heat:[0,2],toughness:[0,2]}},
  {id:"t_blunt",     name:"Blunt",            slot:"weapon",  weights:{common:35,uncommon:38,rare:20,legendary:7},
   statRanges:{fightBonus:[2,6],toughness:[1,3],intimidate:[0,1]}},
  {id:"t_piece",     name:"The Piece",        slot:"weapon",  weights:{common:2,uncommon:10,rare:40,legendary:48},
   statRanges:{fightBonus:[5,10],heat:[1,3],toughness:[0,2]}},
  {id:"t_improvised",name:"Improvised Weapon",slot:"weapon",  weights:{common:60,uncommon:30,rare:8,legendary:2},
   statRanges:{fightBonus:[1,4],toughness:[0,1]}},
  // ACCESSORY
  {id:"t_burner",    name:"Burner",           slot:"accessory",weights:{common:50,uncommon:35,rare:12,legendary:3},
   statRanges:{hustle:[0,2],streetiq:[0,2],bustReduction:[0,0.1]}},
  {id:"t_jewelry",   name:"Jewelry",          slot:"accessory",weights:{common:20,uncommon:40,rare:30,legendary:10},
   statRanges:{charm:[1,4],hustle:[0,2],heat:[0,-1]}},
  {id:"t_tool",      name:"Street Tool",      slot:"accessory",weights:{common:40,uncommon:40,rare:15,legendary:5},
   statRanges:{streetiq:[0,3],hustle:[0,2],bustReduction:[0,0.12]}},
  {id:"t_scanner",   name:"Scanner",          slot:"accessory",weights:{common:10,uncommon:35,rare:40,legendary:15},
   statRanges:{bustReduction:[0.1,0.3],streetiq:[0,3],heat:[0,-2]}},
];

// Unique legendary item names — rolled legendaries get a special name
const LEGENDARY_PREFIXES = ["Bronx","Brooklyn","Queens","Harlem","Flatbush","Bushwick","Bed-Stuy","East New York","Hunts Point","South Bronx","Staten","Midtown"];
const LEGENDARY_SUFFIXES_BY_SLOT = {
  head:    ["of the Five Boroughs","of Invisibility","of the Streets","Hood of Legend","of Eternal Night"],
  chest:   ["of the Untouchable","of Iron","of Shadow","of the Boss","of Last Resort"],
  hands:   ["of the Reaper","of Fury","of the Phantom","of Reckoning","of Retribution"],
  feet:    ["of the Wind","of the Ghost","of Escape","of the Grind","of Endless Miles"],
  weapon:  ["of Last Words","of the Reckoning","of Cold Logic","of Street Justice","of the Final Word"],
  accessory:["of the Fixer","of the Rat","of Perfect Timing","of the Inner Circle","of the Unknown"],
};

// Adjectives for rare item names
const RARE_ADJECTIVES = ["Scarred","Cracked","Weathered","Midnight","Blood-Stained","Well-Worn","Custom","Modified","Reinforced","Stolen","Salvaged","Street-Forged"];

function rollItem(templateId, luckBonus=0) {
  const template = ITEM_TEMPLATES.find(t=>t.id===templateId)
    || ITEM_TEMPLATES[Math.floor(Math.random()*ITEM_TEMPLATES.length)];

  // Determine rarity via weighted roll
  const rarityWeights = template.weights || {common:50,uncommon:30,rare:15,legendary:5};
  const totalW = Object.values(rarityWeights).reduce((a,b)=>a+b,0);
  let rarityRoll = Math.random()*(totalW + luckBonus*10);
  let rarity = "common";
  for(const [r,w] of Object.entries(rarityWeights)){
    rarityRoll -= w;
    if(rarityRoll<=0){rarity=r;break;}
  }
  // luck can push up one tier
  if(luckBonus>0&&Math.random()<luckBonus*0.05){
    const tiers=["common","uncommon","rare","legendary"];
    const idx=tiers.indexOf(rarity);
    if(idx<3)rarity=tiers[idx+1];
  }

  // Roll stats
  const stats = {};
  for(const [stat,[min,max]] of Object.entries(template.statRanges||{})){
    // negative stats (like heat:-2) need special handling
    const absMin=Math.min(Math.abs(min),Math.abs(max));
    const absMax=Math.max(Math.abs(min),Math.abs(max));
    const sign = min<0||max<0 ? -1 : 1;
    // higher rarity = higher end of the range
    const rarityMult = {common:0.4,uncommon:0.65,rare:0.85,legendary:1.0}[rarity];
    const rolledAbs = Math.floor(absMin + Math.random()*(absMax-absMin+1)*rarityMult);
    if(rolledAbs>0) stats[stat] = sign*rolledAbs;
  }

  // Generate flavored name
  let name;
  if(rarity==="legendary"){
    const prefix=LEGENDARY_PREFIXES[Math.floor(Math.random()*LEGENDARY_PREFIXES.length)];
    const suffixes=LEGENDARY_SUFFIXES_BY_SLOT[template.slot]||["of the Streets"];
    const suffix=suffixes[Math.floor(Math.random()*suffixes.length)];
    name=`${prefix} ${template.name} ${suffix}`;
  } else if(rarity==="rare"){
    const adj=RARE_ADJECTIVES[Math.floor(Math.random()*RARE_ADJECTIVES.length)];
    name=`${adj} ${template.name}`;
  } else {
    name=template.name;
  }

  // Generate flavor desc from stats
  const statStr=Object.entries(stats).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
  const desc=`${rarity.charAt(0).toUpperCase()+rarity.slice(1)} drop. ${statStr||"No bonuses"}.`;

  return {
    _rolled: true,                    // marks as rolled item (not static BASE_ITEMS)
    id: templateId+"_"+Date.now()+"_"+Math.floor(Math.random()*9999),
    templateId,
    name,
    slot: template.slot,
    rarity,
    stats,
    desc,
  };
}

function rollItemFromSlot(slot, luckBonus=0){
  const slotTemplates=ITEM_TEMPLATES.filter(t=>t.slot===slot);
  if(!slotTemplates.length)return rollItem(ITEM_TEMPLATES[0].id,luckBonus);
  const t=slotTemplates[Math.floor(Math.random()*slotTemplates.length)];
  return rollItem(t.id,luckBonus);
}

function rollRandomItem(luckBonus=0){
  const t=ITEM_TEMPLATES[Math.floor(Math.random()*ITEM_TEMPLATES.length)];
  return rollItem(t.id,luckBonus);
}

// Get a display-ready item object from either a string ID or a rolled item object
function resolveItem(itemOrId){
  if(!itemOrId)return null;
  if(typeof itemOrId==="object"&&itemOrId._rolled)return itemOrId;
  return BASE_ITEMS.find(i=>i.id===itemOrId||i.name===itemOrId)||null;
}

// Format a rolled item for the feed
function itemDropMsg(item){
  const rar=ITEM_RARITY[item.rarity]||ITEM_RARITY.common;
  const statStr=Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
  return `${rar.prefix}${item.name} [${item.slot}]${statStr?" — "+statStr:""}`;
}

// ── D&D COMBAT ENGINE ─────────────────────────────────────────────────────────
// Dice roller
const roll=(sides,count=1)=>Array.from({length:count},()=>Math.floor(Math.random()*sides)+1).reduce((a,b)=>a+b,0);
const rollStr=(sides,count=1)=>{const rolls=Array.from({length:count},()=>Math.floor(Math.random()*sides)+1);return{total:rolls.reduce((a,b)=>a+b,0),rolls};};

// Ability modifiers (D&D style: stat 1-10 → mod -2 to +4)
const mod=(stat)=>Math.floor((clamp(stat,1,10)-5)/2);

// Combat stats derived from character
const getCombatStats=(gs)=>{
    const _hasRev=(gs.skills||[]).includes("full_revelation");const _sb=gs.isSchizo&&_hasRev&&(gs.survival?.mental||70)<20?3:0;
  const eqStats=getItemStats(gs.equipment||{});
  const toughness=(gs.stats?.toughness||5)+(eqStats.toughness||0);
  const hustle=(gs.stats?.hustle||5)+(eqStats.hustle||0);
  const streetiq=(gs.stats?.streetiq||5)+(eqStats.streetiq||0);
  const fightBonus=(eqStats.fightBonus||0)+(gs.skills||[]).reduce((sum,sid)=>{
    const skill=Object.values(SKILL_TREES).flat().find(s=>s.id===sid);
    return sum+(skill?.effect?.fightBonus||0)+(skill?.effect?.fightMult?2:0);
  },0);
  return {
    ac: 10+mod(toughness)+getArmyDefenseBonus(gs.army||[]),  // Armor Class
    hp: 10+toughness*2+gs.level*2,      // Max HP proxy
    attackBonus: mod(toughness)+mod(hustle)+fightBonus+Math.floor(gs.level/3)+getArmyCombatBonus(gs.army||[]),
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
  // ── STORY BOSSES ────────────────────────────────────────────────────────────
  price:      {name:"Price",                    ac:13,hp:55,attackBonus:6, damage:[8], xp:120,loot:[80,180],  boss:true,
    desc:"Former unit member. Made choices you didn't. Now he's made one more."},
  colonel:    {name:"The Colonel",              ac:15,hp:100,attackBonus:9,damage:[12],xp:300,loot:[200,500], boss:true,
    desc:"He destroyed your file. He thought that would be enough."},
  felix:      {name:"Felix",                    ac:12,hp:45,attackBonus:4, damage:[6], xp:100,loot:[100,250], boss:true,
    desc:"Another hustler. Better connected. More ruthless. So far."},
  broker:     {name:"The Broker",               ac:14,hp:90,attackBonus:8, damage:[10],xp:250,loot:[300,700], boss:true,
    desc:"He controls the city's informal economy. He's not pleased to see competition."},
  skinny:     {name:"Skinny",                   ac:11,hp:40,attackBonus:3, damage:[5], xp:80, loot:[60,150],  boss:true,
    desc:"Small man. Big operation. He's been killing people slowly for two years."},
  chemist:    {name:"The Chemist",              ac:14,hp:80,attackBonus:7, damage:[9], xp:220,loot:[150,400], boss:true,
    desc:"The one at the top of it. PhD. Clean record. Responsible for thousands."},
  echo:       {name:"Echo",                     ac:15,hp:55,attackBonus:5, damage:[7], xp:130,loot:[100,250], boss:true,
    desc:"Another ghost. Works for the other side. Faster than you, maybe."},
  handler:    {name:"The Handler",              ac:14,hp:95,attackBonus:9, damage:[11],xp:280,loot:[200,500], boss:true,
    desc:"The one who made you disappear in the first place."},
  thomas:     {name:"Brother Thomas",           ac:13,hp:70,attackBonus:8, damage:[9], xp:160,loot:[80,200],  boss:true,
    desc:"He's been hunting for thirty years. Knows all the old tricks. Has some of his own."},
  ancient:    {name:"The Ancient",              ac:16,hp:130,attackBonus:11,damage:[14],xp:400,loot:[200,600], boss:true,
    desc:"Before the city was a city. Before the borough was a borough. Territorial. Furious."},
  zero:       {name:"Zero",                     ac:13,hp:50,attackBonus:5, damage:[6], xp:110,loot:[80,200],  boss:true,
    desc:"Playing the same game. But their handler is different. And their target might be you."},
  vale:       {name:"Director Vale",            ac:15,hp:90,attackBonus:9, damage:[10],xp:260,loot:[250,600], boss:true,
    desc:"The man behind the handler. Comfortable. Insulated. Used to being untouchable."},
  kingmaker:  {name:"The Kingmaker",            ac:13,hp:60,attackBonus:5, damage:[7], xp:140,loot:[120,300], boss:true,
    desc:"Doesn't like competition in the deal-making space. Will make that clear."},
  collector:  {name:"The Collector",            ac:14,hp:95,attackBonus:8, damage:[11],xp:270,loot:[200,500], boss:true,
    desc:"Takes cuts from fixers. Has been for years. Considers it a tax."},
  marquise:   {name:"Marquise",                 ac:13,hp:65,attackBonus:6, damage:[8], xp:150,loot:[100,280], boss:true,
    desc:"Runs the stroll. Takes 40%. Has for six years. Not interested in negotiation."},
  pimp:       {name:"Sweet Reggie",             ac:13,hp:80,attackBonus:8, damage:[9], xp:220,loot:[150,400], boss:true,
    desc:"Thinks he owns you. Has for years. Is about to find out otherwise."},
  morrow:     {name:"Dr. Morrow",               ac:12,hp:55,attackBonus:4, damage:[6], xp:120,loot:[80,200],  boss:true,
    desc:"Psychiatrist. Running a study. The study is about you specifically."},
  signal:     {name:"The Signal",               ac:13,hp:75,attackBonus:6, damage:[8], xp:180,loot:[100,300], boss:true,
    desc:"Not what you expected. Nothing like what you expected."},
  dogcatcher: {name:"Officer Reyes (Animal Control)",ac:12,hp:50,attackBonus:4,damage:[5],xp:100,loot:[50,150],boss:true,
    desc:"Following orders. Has taken three dogs this week. Won't take yours."},
  mills:      {name:"Agent Mills",              ac:14,hp:60,attackBonus:6, damage:[7], xp:140,loot:[80,200],  boss:true,
    desc:"Patient. Methodical. Has been building a case for eight months."},
  forger:     {name:"The Forger",               ac:13,hp:85,attackBonus:7, damage:[9], xp:230,loot:[150,400], boss:true,
    desc:"Has what you need. Has had it for three years. Has been leveraging that."},
  mark:       {name:"The Mark",                 ac:12,hp:55,attackBonus:5, damage:[6], xp:120,loot:[80,220],  boss:true,
    desc:"Angry. Embarrassed. Has resources. Has decided to make this personal."},
  kingspin:   {name:"The Kingpin's Accountant", ac:13,hp:80,attackBonus:7, damage:[9], xp:210,loot:[150,400], boss:true,
    desc:"Knows numbers better than anyone. Doesn't know you."},
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

// ── WAREHOUSE RUN SYSTEM ──────────────────────────────────────────────────────
// Each warehouse is a 3-room dungeon. Rooms have: enemies, events, or loot caches.
// Player enters, fights/navigates room by room, collects loot at the end.
// Cooldown: 1 run per warehouse per day. Difficulty scales with player level.

const WAREHOUSE_ROOMS = {
  // Room archetypes — picked randomly per run
  entry: [
    {id:"empty_dock",   desc:"Loading dock. Empty. Crates stacked high. Dusty light through broken skylights.", event:"clear"},
    {id:"watchman",     desc:"A bored watchman with a folding chair and a radio. He hasn't seen you yet.", event:"stealth_or_fight", enemy:"thug"},
    {id:"two_lookouts", desc:"Two teenagers on phones at the door. Lookouts. They clock you the second you enter.", event:"fight_two", enemies:["thug","thug"]},
    {id:"tripwire",     desc:"Fishing line across the doorframe. Alarm wire. You notice it just in time.", event:"skill_check", stat:"streetiq", dc:10},
    {id:"sleeping_guard",desc:"Guard asleep at a desk. Empty bottle of Henny next to him.", event:"stealth_or_skip"},
  ],
  middle: [
    {id:"stash_room",   desc:"A back room. Shelves of product. Someone was moving weight here.", event:"loot_cache"},
    {id:"office",       desc:"Manager's office. File cabinet, safe, cheap desk. Someone left in a hurry.", event:"loot_cache_small"},
    {id:"enforcer_post",desc:"Heavy sitting in a chair blocking the passage. Arms crossed. Waiting.", event:"fight", enemy:"enforcer"},
    {id:"two_dealers",  desc:"Two dealers cutting product at a folding table. They see you the same time you see them.", event:"fight_two", enemies:["dealer","dealer"]},
    {id:"trap_door",    desc:"Floor grate with a padlock. Something below it. The lock is old.", event:"skill_check", stat:"hustle", dc:12, reward:"loot_bonus"},
    {id:"burned_room",  desc:"Fire damage. Exposed wires. Structural damage. Something is still here though.", event:"loot_cache"},
    {id:"snitch",       desc:"A scared kid huddled behind boxes. Not crew. Offers to tell you where the stash is for $20.", event:"npc_choice"},
  ],
  boss: [
    {id:"kingpin_office",desc:"Corner office. Someone important works here. They are here right now.", event:"boss_fight", enemy:"kingpin", bossLoot:true},
    {id:"captain_trap", desc:"The room is set up wrong. Too clean. Too quiet. The Captain steps out of the shadows.", event:"boss_fight", enemy:"boss_captain", bossLoot:true},
    {id:"iceman_cold",  desc:"Walk-in freezer converted to office. Iceman is at the desk. He has been expecting someone.", event:"boss_fight", enemy:"boss_iceman", bossLoot:true},
    {id:"duchess_salon",desc:"The back of the warehouse is set up like a real office. The Duchess is running numbers.", event:"boss_fight", enemy:"boss_duchess", bossLoot:true},
    {id:"main_stash",   desc:"The mother lode. Product stacked floor to ceiling. No guard in sight. Take what you can carry.", event:"loot_jackpot"},
    {id:"safe_room",    desc:"Reinforced door, open. Safe inside, door hanging open. Someone cleaned it out but left the extras.", event:"loot_cache_large"},
  ],
};

const WAREHOUSE_LOCATIONS = {
  manhattan: {
    id:"manhattan", name:"Midtown Facility", short:"MIDT",
    desc:"A converted parking structure off 10th Ave. Four floors. Crew runs product through the freight elevator.",
    minLevel:8, cooldownH:22,
    lootMultiplier:2.0, cashRange:[200,600], heatOnEnter:1,
    flavor:"The security here is real. Cameras. Dogs. Professionals.",
  },
  brooklyn: {
    id:"brooklyn", name:"Atlantic Ave Warehouse", short:"ATL",
    desc:"Industrial block near the BQE. Corrugated steel walls. Smells like motor oil and weed.",
    minLevel:3, cooldownH:20,
    lootMultiplier:1.2, cashRange:[80,220], heatOnEnter:0,
    flavor:"Crew territory. You will see faces you know. That cuts both ways.",
  },
  bronx: {
    id:"bronx", name:"Hunts Point Cold Storage", short:"HUNT",
    desc:"Legitimate-looking outside. Inside it is entirely not that.",
    minLevel:5, cooldownH:21,
    lootMultiplier:1.4, cashRange:[100,300], heatOnEnter:1,
    flavor:"Three exits that you can see. Probably more you cannot.",
  },
  queens: {
    id:"queens", name:"Flushing Depot", short:"FLSH",
    desc:"Export company front. Shipping containers stacked outside. The real operation is inside.",
    minLevel:4, cooldownH:20,
    lootMultiplier:1.3, cashRange:[90,260], heatOnEnter:0,
    flavor:"Mixed crew. Multiple factions run through here. Complicated.",
  },
  staten: {
    id:"staten", name:"Bayway Terminal", short:"BAY",
    desc:"Ferry-adjacent. Easy to get product on and off the island. That is the whole reason it exists.",
    minLevel:1, cooldownH:18,
    lootMultiplier:1.0, cashRange:[50,150], heatOnEnter:0,
    flavor:"Small operation. But it is where people learn.",
  },
};

function generateWarehouseRun(warehouseId, playerLevel, luckBonus=0) {
  const wh = WAREHOUSE_LOCATIONS[warehouseId];
  if(!wh) return null;
  // Pick rooms: 1 entry + 1-2 middle + 1 boss
  const entryRoom = WAREHOUSE_ROOMS.entry[rnd(0, WAREHOUSE_ROOMS.entry.length-1)];
  const midCount = playerLevel >= 6 ? 2 : 1;
  const midRooms = [];
  const midPool = [...WAREHOUSE_ROOMS.middle];
  for(let i=0;i<midCount;i++){
    const idx=rnd(0,midPool.length-1);
    midRooms.push(midPool.splice(idx,1)[0]);
  }
  const bossRoom = WAREHOUSE_ROOMS.boss[rnd(0,WAREHOUSE_ROOMS.boss.length-1)];
  const rooms = [entryRoom, ...midRooms, bossRoom];
  return {
    warehouseId,
    warehouseName: wh.name,
    rooms,
    currentRoom: 0,
    totalRooms: rooms.length,
    loot: [],           // items collected during run
    cashFound: 0,       // cash found during run
    lootMultiplier: wh.lootMultiplier,
    cashRange: wh.cashRange,
    status: "active",   // active | complete | failed | fled
    startTime: Date.now(),
    heatOnEnter: wh.heatOnEnter,
  };
}
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

// ── ONBOARDING SYSTEM ────────────────────────────────────────────────────────
// Guided first session — walks new players through core loop in 8 steps
const TUTORIAL_STEPS = [
  { id:"look",
    trigger:"LOOK",
    msg:"First thing you do when you hit a new block: LOOK around. Type LOOK.",
    hint:"→ LOOK",
    narrative:null,
    reward:null },
  { id:"status",
    trigger:"STATUS",
    msg:"Good. You're alive. Check your stats — type STATUS.",
    hint:"→ STATUS",
    narrative:"You take stock. Health, hunger, warmth, energy. Mental. The things that keep you upright.",
    reward:null },
  { id:"hustle",
    trigger:"HUSTLE",
    msg:"You need money. This block runs on hustle. Type HUSTLE to work it.",
    hint:"→ HUSTLE",
    narrative:"Everyone has an angle. Yours is whatever you can manage before someone notices.",
    reward:null },
  { id:"scout",
    trigger:"SCOUT",
    msg:"Smart move before buying anything — check the market. Type SCOUT.",
    hint:"→ SCOUT",
    narrative:"Prices move. A bag that's worth $110 in Manhattan goes for $70 here. Knowing the spread is the whole job.",
    reward:{cash:10} },
  { id:"buy",
    trigger:"BUY",
    msg:"Now buy something to flip. Try BUY WEED 1.",
    hint:"→ BUY WEED 1",
    narrative:"One bag. Small enough not to draw attention. The goal is to move it somewhere the price is better.",
    reward:null },
  { id:"sell",
    trigger:"SELL",
    msg:"Move it. Type SELL WEED 1 — same block to start, just to learn the flow.",
    hint:"→ SELL WEED 1",
    narrative:"You're not making money yet. You're learning the rhythm. Buy low somewhere, sell high somewhere else. That's the whole game.",
    reward:{cash:15} },
  { id:"sleep",
    trigger:"SLEEP",
    msg:"End your first day. Type SLEEP — health recovers, hunger resets, day advances.",
    hint:"→ SLEEP",
    narrative:"Day one. You made it. Tomorrow the contracts board resets, the market shifts, and something will happen that you didn't expect. That's the city.",
    reward:{xp:30,cash:20} },
  { id:"done",
    trigger:null,
    msg:"You know enough to survive. CONTRACTS for daily jobs. SCOUT before buying. Watch your heat. Good luck.",
    hint:null,
    narrative:null,
    reward:null },
];
// ── NOTORIETY TITLES ─────────────────────────────────────────────────────────
// Earned after 10 days based on playstyle — shows under name citywide
const NOTORIETY_TITLES = [
  {id:"the_grinder",    title:"THE GRINDER",    icon:"💊", test:(l)=>l.deals>=50,          desc:"Moved 50+ units. The economy runs through you."},
  {id:"the_ghost_rep",  title:"THE GHOST",      icon:"🌫", test:(l,gs)=>gs.heat<=2&&l.daysAlive>=10, desc:"10 days. Never over heat 2. Nobody sees you coming."},
  {id:"the_hunter",     title:"THE HUNTER",     icon:"⚔",  test:(l)=>l.pvpWins>=5,         desc:"5 player wins. They know not to cross you."},
  {id:"the_talker",     title:"THE DIPLOMAT",   icon:"🤝", test:(l)=>l.talkCount>=30,       desc:"30 NPC conversations. The street trusts you."},
  {id:"the_panhandler", title:"THE REGULAR",    icon:"🎭", test:(l)=>l.panhandles>=20,      desc:"20 successful panhandles. This corner knows your face."},
  {id:"the_boss_slayer",title:"BOSS SLAYER",    icon:"👹", test:(l)=>l.bossKills>=3,        desc:"Dropped 3 bosses. Legends don't die easy."},
  {id:"the_survivor",   title:"THE SURVIVOR",   icon:"🏴", test:(l)=>l.daysAlive>=20,       desc:"20 days alive. Most don't make it half that."},
  {id:"the_wealthy",    title:"THE MONEY",      icon:"💰", test:(l)=>l.cashEarned>=5000,    desc:"$5,000 earned lifetime. Paper over everything."},
  {id:"the_corner_king",title:"CORNER KING",    icon:"🚩", test:(l)=>l.corners>=10,         desc:"10 corners claimed. The map is yours."},
  {id:"the_legend",     title:"THE LEGEND",     icon:"👑", test:(l,gs)=>gs.level>=8&&l.daysAlive>=15&&l.deals>=30, desc:"Level 8+, 15 days, 30 deals. There is nobody else."},
];

const getNotorietyTitle=(gs)=>{
  if(!gs?.lifetime||gs.day<10)return null; // need 10 days before title
  const l=gs.lifetime;
  // Return highest-tier matching title
  const matches=NOTORIETY_TITLES.filter(t=>t.test(l,gs));
  return matches[matches.length-1]||null; // last = highest tier
};

const checkNotoriety=(gs,updGs,push,worldRef,saveWorld)=>{
  const earned=getNotorietyTitle(gs);
  if(!earned)return;
  const already=gs.notorietyTitle===earned.id;
  if(!already){
    updGs(g=>({...g,notorietyTitle:earned.id}));
    const notWs=broadcastActivity((worldRef&&worldRef.current)||defWorld(),gs.name+" earned the notoriety title: "+earned.icon+" "+earned.title+".","🏆");
    if(worldRef&&worldRef.current&&saveWorld)saveWorld(notWs);
    push("",""+earned.icon+" NOTORIETY EARNED: "+earned.title,""+earned.desc,"Type TITLE to see all your stats.","");
  }
};

const getItemStats=(equipment)=>{
  const totals={};
  Object.values(equipment||{}).forEach(itemOrId=>{
    if(!itemOrId)return;
    const item=typeof itemOrId==="object"&&itemOrId._rolled ? itemOrId : getItemById(itemOrId);
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

// ── DAILY CONTRACTS ─────────────────────────────────────────────────────────────
const CONTRACT_TEMPLATES = [
  // Deal contracts
  {id:"sell_weed_bkn",   cat:"deal",   title:"Move Weight in Brooklyn",    desc:"A connect needs 3 units of weed moved in Brooklyn. Today only.",           task:{type:"sell",product:"weed",qty:3,boro:"brooklyn"},   reward:{cash:120,xp:40,rep:1},  diff:"easy"},
  {id:"sell_powder_man", cat:"deal",   title:"Manhattan Powder Run",       desc:"Premium powder. Manhattan buyers. 4 units before midnight.",                task:{type:"sell",product:"powder",qty:4,boro:"manhattan"}, reward:{cash:280,xp:60,rep:2},  diff:"medium"},
  {id:"sell_pills_qns",  cat:"deal",   title:"Queens Pills Drop",          desc:"Medical-grade pills needed in Queens. 3 units. Cash on delivery.",           task:{type:"sell",product:"pills",qty:3,boro:"queens"},    reward:{cash:150,xp:45,rep:1},  diff:"easy"},
  {id:"move_any_bronx",  cat:"deal",   title:"Bronx Distribution",        desc:"Don't care what it is. Move 5 units of anything in the Bronx.",              task:{type:"sell",product:"any",qty:5,boro:"bronx"},       reward:{cash:200,xp:50,rep:2},  diff:"medium"},
  {id:"multi_boro",      cat:"deal",   title:"Cross-Borough Run",         desc:"Sell in 3 different boroughs today. Each one counts.",                       task:{type:"multiboro",qty:3},                             reward:{cash:350,xp:80,rep:3},  diff:"hard"},
  // Combat contracts
  {id:"fight_anyone",    cat:"combat", title:"Prove Yourself",            desc:"Word is you're soft. Start a fight today. Win it.",                          task:{type:"fight",wins:1},                                reward:{cash:100,xp:35,heat:1}, diff:"easy"},
  {id:"rob_player",      cat:"combat", title:"Tax Collection",            desc:"Someone in this city owes money. Doesn't matter who. Rob a player today.",   task:{type:"rob",qty:1},                                   reward:{cash:150,xp:50,heat:2}, diff:"medium"},
  {id:"boss_hunt",       cat:"combat", title:"Take Down a Boss",          desc:"There's a boss-level threat operating in the city. Neutralize them.",         task:{type:"bossfight",qty:1},                             reward:{cash:400,xp:150,rep:3}, diff:"hard"},
  {id:"corner_war",      cat:"combat", title:"Corner Takeover",           desc:"Claim a corner that belongs to someone else today.",                          task:{type:"corner_steal",qty:1},                          reward:{cash:180,xp:55,rep:2},  diff:"medium"},
  // Survival contracts
  {id:"stay_clean",      cat:"survive","title":"Ghost Mode",              desc:"Don't get wanted all day. Stay off the radar from now until you sleep.",      task:{type:"no_wanted"},                                   reward:{cash:80,xp:30,heat:-2}, diff:"easy"},
  {id:"low_heat",        cat:"survive","title":"Ice Cold",                desc:"End the day with heat below 3. Start managing it now.",                       task:{type:"low_heat",threshold:3},                        reward:{cash:120,xp:40,rep:1},  diff:"medium"},
  {id:"survive_blizzard",cat:"survive","title":"Winter Soldier",          desc:"Survive the day without dropping below 50% warmth. No shelter allowed.",     task:{type:"warmth",threshold:50},                         reward:{cash:150,xp:45},        diff:"medium",weatherOnly:"blizzard"},
  {id:"stay_fed",        cat:"survive","title":"Full Stomach",            desc:"Keep hunger above 60% all day. Actually take care of yourself.",              task:{type:"hunger",threshold:60},                         reward:{cash:90,xp:30,mental:15},diff:"easy"},
  // Community contracts
  {id:"talk_all_npcs",   cat:"community","title":"Working the Room",      desc:"Talk to 3 different NPCs today. Build relationships.",                        task:{type:"talk",qty:3},                                  reward:{cash:80,xp:35,rep:2},   diff:"easy"},
  {id:"help_shelter",    cat:"community","title":"Give Something Back",   desc:"Check into a shelter today. Donate $20 on the way out.",                      task:{type:"shelter",cash:20},                             reward:{cash:60,xp:25,mental:20,rep:1},diff:"easy"},
  {id:"panhandle_grind", cat:"community","title":"The Long Sit",          desc:"Panhandle 4 times today. The city owes you something.",                       task:{type:"panhandle",qty:4},                             reward:{cash:100,xp:30,mental:10},diff:"medium"},
];

// Generate 3 daily contracts for the world
const generateDailyContracts=(day,weather)=>{
  // Deterministic per day so all players see the same contracts
  const seed=day*7+weather.id.length;
  const available=CONTRACT_TEMPLATES.filter(c=>!c.weatherOnly||c.weatherOnly===weather.id);
  const picks=[];const used=new Set();
  // One easy, one medium, one hard/medium
  const byDiff={easy:available.filter(c=>c.diff==="easy"),medium:available.filter(c=>c.diff==="medium"),hard:available.filter(c=>c.diff==="hard")};
  const pick=(pool,s)=>{const idx=(s*31+seed)%pool.length;return pool[idx];};
  const c1=pick(byDiff.easy,1);
  const c2=pick(byDiff.medium.filter(c=>c.id!==c1?.id),2);
  const c3=pick([...byDiff.hard,...byDiff.medium].filter(c=>c.id!==c1?.id&&c.id!==c2?.id),3);
  return[c1,c2,c3].filter(Boolean).map(c=>({...c,expires:day,completedBy:[]}));
};

// ── OFFLINE EVENTS — happen while player is away ────────────────────────────
// Generated on login based on time away, heat, army, corners
const generateOfflineReport=(gs,world,hoursAway)=>{
  if(hoursAway<1)return null;
  const events=[];
  const army=gs.army||[];
  const corners=gs.cornersOwned||[];
  const hasLookout=army.some(u=>u.id==="lookout");
  const hasEnforcer=army.some(u=>u.id==="enforcer");
  const hasLt=army.some(u=>u.id==="lieutenant");

  // Corner activity
  corners.forEach(bId=>{
    const boro=getBoro(bId);if(!boro)return;
    const rivals=Object.entries(world.players||{}).filter(([n,d])=>n!==gs.name&&d.borough===bId);
    if(rivals.length>0&&Math.random()<0.3){
      const [rName]=rivals[Math.floor(Math.random()*rivals.length)];
      if(hasEnforcer||hasLt){
        events.push(`👁 ${rName} was spotted near your ${boro.short} corner. Your ${hasLt?"lieutenant":"enforcer"} held them off.`);
      } else {
        events.push(`⚠ ${rName} circled your ${boro.short} corner while you were out. No army — could have gone badly.`);
      }
    }
    // Random corner income event
    if(Math.random()<0.2){
      const bonus=rnd(10,40);
      events.push(`💰 Your ${boro.short} corner had a good night. +$${bonus} extra.`);
      // Would actually give cash — handled separately
    }
  });

  // Police activity based on heat
  if(gs.heat>5&&Math.random()<0.4){
    if(hasLookout){
      events.push(`🚔 Patrol swept through ${getBoro(gs.armyDeployed||"manhattan")?.name||"the area"}. Your lookout spotted them in time. No bust.`);
    } else {
      events.push(`🚔 Cops were active in your area while you slept. Heat may have shifted.`);
    }
  }

  // Rival activity
  const myRivals=Object.keys(world.rivals||{}).filter(k=>k.startsWith(gs.name+":"));
  if(myRivals.length>0&&Math.random()<0.3){
    const rivalName=myRivals[0].split(":")[1];
    events.push(`👊 Word is ${rivalName} was talking about you while you were gone.`);
  }

  // Random city events
  const cityEvents=[
    `🌆 The city kept moving while you slept. Same as always.`,
    `🌙 Quiet night in your borough. Nobody made a move.`,
    `📦 A shipment came through. Prices shifted overnight.`,
    `🗞 The block is talking about something. Check the newspaper.`,
  ];
  if(events.length<2)events.push(cityEvents[rnd(0,cityEvents.length-1)]);

  // Upkeep reminder
  if(army.length>0){
    const upkeep=getArmyUpkeep(army);
    events.push(`💪 Army upkeep due: $${upkeep}. Paid on SLEEP.`);
  }

  return events.slice(0,5); // max 5 offline events
};

// ── WEEKLY LEADERBOARD ──────────────────────────────────────────────────────
const LEADERBOARD_CATEGORIES = [
  {id:"cash",     label:"Most Cash Earned",    icon:"💰", key:"cashEarned"},
  {id:"pvp",      label:"Most PvP Wins",        icon:"⚔",  key:"pvpWins"},
  {id:"deals",    label:"Most Deals",           icon:"💊", key:"deals"},
  {id:"survival", label:"Longest Alive",        icon:"🏴", key:"daysAlive"},
  {id:"bosses",   label:"Most Boss Kills",      icon:"👹", key:"bossKills"},
];

const WEEKLY_REWARDS = {
  cash:     {title:"THE EARNER",   item:"Money Clip",    cash:500},
  pvp:      {title:"THE PREDATOR", item:"Brass Knuckles",cash:300},
  deals:    {title:"THE DEALER",   item:"Burner Stash",  cash:400},
  survival: {title:"THE UNKILLABLE",item:"Scar Tissue",  cash:250},
  bosses:   {title:"BOSS HUNTER",  item:"Boss Trophy",   cash:600},
};

// Get real-world week number
const getWeekNumber=()=>Math.floor(Date.now()/(1000*60*60*24*7));

// ── WORLD EVENTS — fire every 3-4 real days, affect everyone ────────────────
const WORLD_EVENTS = [
  { id:"crackdown",
    title:"NYPD CRACKDOWN",
    icon:"🚔",
    boroughs:["manhattan","bronx"],
    duration:2, // game days
    effect:{copMult:2.0, bustMult:1.8, heatGainMult:1.5},
    desc:"The mayor called it in. Heavy police presence in Manhattan and the Bronx. Plainclothes everywhere. Bust chance doubled. Move your product or sit tight.",
    newspaper:"NYPD launches surge operation in upper Manhattan and the Bronx. Officers say the operation will last 48 hours.",
    warning:"⚠ Crackdown incoming tomorrow — Manhattan and Bronx. Move product now or stash it.",
  },
  { id:"supply_drought",
    title:"DRY SPELL",
    icon:"🏜",
    boroughs:["queens","brooklyn","staten"],
    duration:1,
    effect:{supplyDrought:true, priceSpike:1.6},
    desc:"Supply chain issues. Product is scarce in Queens, Brooklyn, and Staten Island. Prices are spiking. If you have stock, now is the time.",
    newspaper:"Street-level supply appears disrupted across outer boroughs. Prices for illicit goods reportedly at seasonal highs.",
    warning:"⚠ Supply drought hitting Queens, Brooklyn, Staten Island tomorrow. Stock up today.",
  },
  { id:"shelter_crisis",
    title:"SHELTER CRISIS",
    icon:"🏚",
    boroughs:["bronx","brooklyn","queens"],
    duration:2,
    effect:{shelterCapMult:0.4},
    desc:"City funding cuts. Three shelters operating at reduced capacity. Beds are scarce. If you need a bed tonight, get there early.",
    newspaper:"Advocates warn of bed shortage at city shelters after funding shortfall. Officials say overflow sites are being arranged.",
    warning:"⚠ Shelter capacity dropping tomorrow. Bronx, Brooklyn, Queens. Plan ahead.",
  },
  { id:"heat_wave",
    title:"HEAT EMERGENCY",
    icon:"🌡",
    boroughs:["manhattan","queens","brooklyn"],
    duration:2,
    effect:{warmthDrainMult:0, energyDrainMult:1.4, hungerDrainMult:1.3},
    desc:"95 degrees and nowhere to go. Warmth isn't a problem — staying energized and fed is. Cooling centers open at shelters. Cops are irritable.",
    newspaper:"Heat emergency declared. City opens cooling centers at shelters city-wide. Temperatures expected to stay above 90 through tomorrow.",
    warning:"⚠ Heat wave hitting tomorrow. Warmth stops draining but energy and hunger drain faster.",
  },
  { id:"transit_strike",
    title:"TRANSIT STRIKE",
    icon:"🚇",
    boroughs:["manhattan","bronx","queens","brooklyn","staten"],
    duration:1,
    effect:{moveCostMult:2.0, metrocardDisabled:true},
    desc:"MTA workers walked out at 6am. No trains, limited buses. Moving between boroughs costs double energy. MetroCards are worthless today.",
    newspaper:"MTA workers on strike for second day. Service suspended on all subway lines. Officials urge commuters to work from home.",
    warning:"⚠ Transit strike tomorrow. Moving boroughs costs 2x energy. MetroCards won't work.",
  },
  { id:"cold_snap",
    title:"COLD SNAP",
    icon:"🌨",
    boroughs:["manhattan","bronx","brooklyn","queens","staten"],
    duration:2,
    effect:{warmthDrainMult:2.5, shelterDemandMult:1.5},
    desc:"Temperature dropped 30 degrees overnight. Warmth is draining fast. Shelter beds fill up early. The city gets mean when it's cold.",
    newspaper:"Temperatures plunging into the teens overnight. Hypothermia risk elevated. City opens emergency warming centers.",
    warning:"⚠ Cold snap coming. Warmth drains 2.5x faster. Get to a shelter early.",
  },
  { id:"block_party",
    title:"BLOCK PARTY WEEKEND",
    icon:"🎉",
    boroughs:["brooklyn","queens"],
    duration:1,
    effect:{panhandleMult:2.0, heatGainMult:0.6, npcRepMult:1.5},
    desc:"Street festival in Brooklyn and Queens. Crowds everywhere, cops are friendly, NPCs are generous. Best panhandle day of the year.",
    newspaper:"Annual block party draws thousands to Brooklyn and Queens. Community events run through the weekend.",
    warning:"🎉 Block party tomorrow in Brooklyn and Queens. Great day to panhandle and build rep.",
  },
  { id:"city_council",
    title:"CITY COUNCIL HEARING",
    icon:"🏛",
    boroughs:["manhattan"],
    duration:1,
    effect:{copMult:0.5, heatGainMult:0.6},
    desc:"City council is reviewing police conduct complaints. Cops are on their best behavior in Manhattan today. Low heat risk window.",
    newspaper:"City council holds hearing on police conduct. Officers instructed to de-escalate encounters pending review.",
    warning:"🏛 Cops laying low in Manhattan tomorrow. Low heat risk window.",
  },
];

// Deterministic world event per real-world day (changes every 3 real days)
const getWorldEvent=(realDay)=>{
  if(realDay%3!==0)return null; // fires every 3 days
  const idx=Math.floor(realDay/3)%WORLD_EVENTS.length;
  return WORLD_EVENTS[idx];
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
  // ── THE INCIDENT ─────────────────────────────────────────────────────────────
  { id:"alien_incident", prob:0.015, title:"The Incident",
    nightOnly:true, // only fires between midnight and 4am
    boroughs:["queens","staten","brooklyn"], // outer borough, industrial zones
    desc:"Your dog stops walking. Completely still. Not scared — focused. You follow her eyeline. Over the water. Something is hovering. Not a helicopter. No sound. No blinking lights. Just a shape that shouldn't be there, lit from inside, the color of something you don't have a word for. It stays for eleven seconds. Then it's gone. You count. Eleven seconds.",
    descSchizo:"You knew this was coming. You told people. Nobody listened. The voices have been saying Red Hook for three weeks. You are standing in Red Hook at 3am and there it is. Eleven seconds. Then gone. You feel, for the first time in years, completely calm.",
    descDrifter:"Your dog stopped first. That's how you know it was real. She's never wrong. You watched it together — you and her, standing at the waterfront at 3am, watching something that had no business being here. She wagged her tail once. You don't know what that means. You've been thinking about it ever since.",
    choices:[
      {label:"Walk toward it",   fn:(g)=>({...g,
        xp:(g.xp||0)+200,
        inventory:[...g.inventory,"Alien Encounter Report"],
        title:g.title||(g.isSchizo?"FIRST CONTACT":"BELIEVER"),
        survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+30)},
      }), outcome:"You walk toward it. Eleven seconds of something impossible. Then dark water and the smell of the harbor and your own heartbeat. You stand there for a long time. You don't tell anyone. Nobody would believe you anyway. But you know. You know."},
      {label:"Stay still",       fn:(g)=>({...g,
        xp:(g.xp||0)+50,
        survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+15)},
      }), outcome:"You stay still. Watch it. Commit every detail to memory. The shape. The light. The silence. Eleven seconds. When it's gone you walk away and don't look back. Some things you carry alone."},
      {label:"Film it",          fn:(g)=>{const hasPhone=g.inventory.includes("Burner Phone")||g.inventory.includes("Found Phone")||g.inventory.includes("Burner");return hasPhone?{...g,xp:(g.xp||0)+300,inventory:[...g.inventory,"Alien Footage","Alien Encounter Report"],title:g.title||"WITNESS"}:{...g,xp:(g.xp||0)+50,survival:{...g.survival,mental:Math.min(100,(g.survival.mental||70)+10)}};},
        outcome:"You reach for your phone. If you have one, you film it. If you don't, you watch it go and decide you'll remember everything. Either way it changes something."},
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

// ── PORTRAIT FRAMES ─────────────────────────────────────────────────────────
const PORTRAIT_FRAMES = {
  veteran:      ["┌──────────┐","│  🎖      │","│  [{}]    │","│  ~~~     │","└──────────┘"],
  schemer:      ["┌──────────┐","│  🃏      │","│  [{}]    │","│  ...     │","└──────────┘"],
  ghost:        ["┌──────────┐","│  🌫      │","│  [{}]    │","│  ·  ·    │","└──────────┘"],
  hustler:      ["┌──────────┐","│  💵      │","│  [{}]    │","│  $$$     │","└──────────┘"],
  junkie:       ["┌──────────┐","│  💉      │","│  [{}]    │","│  :::     │","└──────────┘"],
  undocumented: ["┌──────────┐","│  🌐      │","│  [{}]    │","│  ---     │","└──────────┘"],
  vampire:      ["┌──────────┐","│  🧛      │","│  [{}]    │","│  ▓▓▓     │","└──────────┘"],
  fixer:        ["┌──────────┐","│  🔧      │","│  [{}]    │","│  ===     │","└──────────┘"],
  rat:          ["┌──────────┐","│  🐀      │","│  [{}]    │","│  ~~~     │","└──────────┘"],
  hooker:       ["┌──────────┐","│  💄      │","│  [{}]    │","│  ♦♦♦     │","└──────────┘"],
  schizo:       ["┌──────────┐","│  🌀      │","│  [{}]    │","│  ???     │","└──────────┘"],
  drifter:      ["┌──────────┐","│  🐕      │","│  [{}]    │","│  ___     │","└──────────┘"],
};

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

  const weapon=gs.equipment?.weapon?(typeof gs.equipment.weapon==="object"&&gs.equipment.weapon._rolled?gs.equipment.weapon:getItemById(gs.equipment.weapon)):null;
  const chest=gs.equipment?.chest?(typeof gs.equipment.chest==="object"&&gs.equipment.chest._rolled?gs.equipment.chest:getItemById(gs.equipment.chest)):null;
  const head=gs.equipment?.head?(typeof gs.equipment.head==="object"&&gs.equipment.head._rolled?gs.equipment.head:getItemById(gs.equipment.head)):null;
  const acc=gs.equipment?.accessory?(typeof gs.equipment.accessory==="object"&&gs.equipment.accessory._rolled?gs.equipment.accessory:getItemById(gs.equipment.accessory)):null;

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
            <div style={{color:`${color}88`,fontSize:7,letterSpacing:1}}>{gs.archetype?.name}{gs.title?` · ${gs.title}`:""}{gs.isDrifter&&gs.dogName?` 🐕 ${gs.dogName}`:""}{(()=>{const nt=getNotorietyTitle(gs);return nt&&!gs.title?` · ${nt.icon} ${nt.title}`:null;})()}</div>
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
  const equippedIds=new Set(Object.values(equipment||{}).filter(Boolean).map(i=>typeof i==="object"&&i._rolled?i.id:i));
  return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:2}}>
    {(items||[]).map((item,i)=>{
      const isRolled=typeof item==="object"&&item._rolled;
      const baseItem=isRolled?item:BASE_ITEMS.find(b=>b.name===item||b.id===item);
      const rar=baseItem?ITEM_RARITY[baseItem.rarity]:null;
      const isEquipped=isRolled?equippedIds.has(item.id):equippedIds.has(item)||equippedIds.has(baseItem?.id);
      const displayName=isRolled?item.name:(typeof item==="string"?item:"?");
      return <div key={i} onClick={()=>baseItem&&onEquip&&onEquip(isRolled?item:baseItem)} style={{
        height:42,border:"1px solid "+(isEquipped?rar?.color||"#2a9d8f":rar?rar.color+"44":"#1a1a1a"),
        background:isEquipped?(rar?.color||"#2a9d8f")+"15":baseItem?"#0f0f0f":"#080808",
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
        fontSize:6,fontFamily:"'Share Tech Mono',monospace",
        color:isEquipped?rar?.color||"#2a9d8f":rar?.color||"#666",
        textAlign:"center",padding:2,lineHeight:1.3,cursor:baseItem?"pointer":"default",
        position:"relative",
      }}>
        {rar&&<div style={{fontSize:7,marginBottom:1}}>{RARITY_SYMBOL[baseItem.rarity]||"·"}</div>}
        <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%",padding:"0 2px"}}>{displayName||"·"}</div>
        {isRolled&&<div style={{fontSize:5,color:rar?.color||"#888",marginTop:1}}>{Object.entries(item.stats||{}).filter(([,v])=>v).slice(0,2).map(([k,v])=>(v>0?"+":"")+v+k).join(" ")}</div>}
        {isEquipped&&<div style={{fontSize:5,color:rar?.color||"#2a9d8f"}}>EQP</div>}
      </div>;
    })}
  </div>;
}
function MktPanel({bId,day,prod,setProd,qty,setQty,onBuy,onSell,playerProd,weather,worldSupply}){
  return <div style={{fontSize:8,fontFamily:"'Share Tech Mono',monospace"}}>
    <div style={{color:"#999",letterSpacing:2,marginBottom:6}}>// MARKET — {getBoro(bId)?.short}</div>
    {Object.entries(PRODUCTS).map(([key,p])=>{
      const sp=mktPrice(bId,key,day,weather?.id,worldSupply),bp=Math.round(sp*p.bm);
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
  const [chatStrip,setChatStrip]=useState(true); // persistent bottom chat strip
  const [toast,setToast]   =useState(null);      // floating notification
  const lastToastRef=useRef({});
  const [crewMsg,setCrewMsg]=useState(false);    // crew-only chat mode
  const [typingUser,setTypingUser]=useState(null);// typing indicator
  const [dungeon,setDungeon]=useState(null);      // active warehouse run state
  const gsRef=useRef(null);
  const pinRef=useRef(null);const feedRef=useRef(null);const inputRef=useRef(null);
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
  useEffect(()=>{(async()=>{try{const w=await loadWorld();if(w)setWorld(w);cleanStaleCharacters(30).catch(()=>{});}catch(e){console.error(e)}})();},[]);

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
    // World event headline
    const realD=Math.floor(Date.now()/(1000*60*60*24));
    const todayEv=getWorldEvent(realD);
    const tomorrowEv=getWorldEvent(realD+1);
    if(todayEv)headlines.push(todayEv.newspaper);
    if(tomorrowEv&&tomorrowEv.id!==todayEv?.id)headlines.push("TOMORROW: "+tomorrowEv.warning.replace("⚠ ","").replace("🎉 ","").replace("🏛 ",""));
    // Check for alien incident in world history
    const alienEvent=history.find(h=>h.type==="alien");
    if(alienEvent&&day-( alienEvent.day||0)<=1){
      headlines.push(`${alienEvent.actor} reported unusual activity over the waterfront last night. No official comment.`);
    }

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

  // Track contract progress
  const trackContract=(taskType,data={})=>{
    if(!gs)return;
    const today=world.contracts||[];
    if(today.length===0)return;
    const myCompleted=gs.contractsCompleted||[];
    const myProgress=gs.contractProgress||{};
    let newCompleted=[...myCompleted];
    let newProgress={...myProgress};
    let completedNow=[];
    today.forEach(c=>{
      if(myCompleted.includes(c.id))return;
      const prog=newProgress[c.id]||{count:0,boros:[]};
      let progNew={...prog};
      let complete=false;
      // Check if this action advances the contract
      if(c.task.type==="sell"&&taskType==="sell"){
        if(c.task.product==="any"||(data.product&&c.task.product===data.product)){
          if(!c.task.boro||c.task.boro===data.boro){
            progNew.count=(progNew.count||0)+(data.qty||1);
            if(progNew.count>=(c.task.qty||1))complete=true;
          }
        }
      }
      if(c.task.type==="multiboro"&&taskType==="sell"){
        const boros=[...(progNew.boros||[])];
        if(!boros.includes(data.boro)){boros.push(data.boro);progNew.boros=boros;}
        if(boros.length>=(c.task.qty||3))complete=true;
      }
      if(c.task.type==="fight"&&taskType==="fight_win"){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.wins||1))complete=true;}
      if(c.task.type==="rob"&&taskType==="rob_win"){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.qty||1))complete=true;}
      if(c.task.type==="bossfight"&&taskType==="boss_win"){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.qty||1))complete=true;}
      if(c.task.type==="corner_steal"&&taskType==="corner_steal"){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.qty||1))complete=true;}
      if(c.task.type==="talk"&&taskType==="talk"){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.qty||1))complete=true;}
      if(c.task.type==="panhandle"&&taskType==="panhandle"&&data.success){progNew.count=(progNew.count||0)+1;if(progNew.count>=(c.task.qty||1))complete=true;}
      if(c.task.type==="shelter"&&taskType==="shelter"){complete=true;}
      if(c.task.type==="no_wanted"&&taskType==="got_wanted"){complete=false;progNew.failed=true;}
      if(c.task.type==="low_heat"&&taskType==="sleep_check"){if(data.heat<=(c.task.threshold||3))complete=true;}
      if(c.task.type==="warmth"&&taskType==="sleep_check"){if(data.warmth>=(c.task.threshold||50))complete=true;}
      if(c.task.type==="hunger"&&taskType==="sleep_check"){if(data.hunger>=(c.task.threshold||60))complete=true;}
      newProgress[c.id]=progNew;
      if(complete&&!progNew.failed){
        newCompleted.push(c.id);
        completedNow.push(c);
      }
    });
    if(completedNow.length>0){
      updGs(g=>{
        let ng={...g,contractsCompleted:newCompleted,contractProgress:newProgress};
        completedNow.forEach(c=>{
          ng={...ng,
            cash:ng.cash+(c.reward.cash||0),
            xp:ng.xp+(c.reward.xp||0),
            heat:clamp(ng.heat+(c.reward.heat||0),0,10),
            survival:{...ng.survival,mental:Math.min(100,(ng.survival.mental||70)+(c.reward.mental||0))},
          };
          if(c.reward.rep){BOROUGHS.forEach(b=>{ng={...ng,rep:{...ng.rep,[b.id]:Math.min(10,(ng.rep[b.id]||0)+c.reward.rep)}};})}
        });
        return ng;
      });
      setTimeout(()=>{
        completedNow.forEach(c=>{
          push("","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            "📋 CONTRACT COMPLETE: "+c.title,
            "+$"+( c.reward.cash||0)+(c.reward.xp?" +"+c.reward.xp+"XP":"")+(c.reward.rep?" +rep":""),
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━","");
          const _ctMsgs=[
              gs.name+` finished the "${c.title}" contract. +$`+c.reward.cash+`. Getting paid out here.`,
              `Contract done. ${gs.name} collected $`+c.reward.cash+` on "${c.title}".`,
              `${gs.name} is running the board. "${c.title}" — complete. +$`+c.reward.cash+`.`,
            ];
            const bWs=broadcastActivity(world,_ctMsgs[rnd(0,_ctMsgs.length-1)],"📋");
          setWorld(bWs);saveWorld(bWs);
        });
      },100);
    } else if(newCompleted.length!==myCompleted.length||JSON.stringify(newProgress)!==JSON.stringify(myProgress)){
      updGs(g=>({...g,contractsCompleted:newCompleted,contractProgress:newProgress}));
    }
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
    // add to world chat as a system message — tagged so toast doesn't fire for these
    const entry={from:"SYSTEM",text:msg,time:Date.now(),boro:"system",system:true,type:"system"};
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
    if(newMsgs.length>prevMsgCount){
      const newOnes=newMsgs.slice(prevMsgCount);
      // Only toast/count genuine player chat — filter out SYSTEM broadcasts and activity entries
      const fromOthers=newOnes.filter(m=>
        m.from &&
        m.from!==gsRef.current?.name &&
        m.from!=="SYSTEM" &&
        !m.system &&
        m.type!=="activity" && m.type!=="event" && m.type!=="prestige" &&
        m.type!=="pvp" && m.type!=="world" && m.type!=="system"
      );
      if(fromOthers.length>0){
        if(tab!=="chat")setUnread(u=>u+fromOthers.length);
        // Toast only for direct player chat — once per sender per 60 seconds
        const latest=fromOthers[fromOthers.length-1];
        if(latest&&latest.from&&Date.now()-(lastToastRef.current[latest.from]||0)>60000){
          lastToastRef.current[latest.from]=Date.now();
          setToast({from:latest.from,text:latest.text,arch:latest.arch,time:Date.now()});
          setTimeout(()=>setToast(null),4000);
        }
      }
    }
    setPulse(true);setTimeout(()=>setPulse(false),800);
    const g=gsRef.current;if(!g)return;
    // player alerts — attacks, bounties, wires, dominates etc
    // World event — check and display
    const _rd=Math.floor(Date.now()/(1000*60*60*24));
    const _te=getWorldEvent(_rd);
    if(_te){setWorld(prev=>({...prev,worldEvent:_te,worldEventDay:_rd}));}
        // Check unread letters
    // Check rivals
    const _myRivs=Object.entries(normalized.rivals||{}).filter(([k,v])=>k.startsWith(g.name+":")&&v>=2);
    if(_myRivs.length>0&&!worldRef.current?.rivals){
      setTimeout(()=>setFeed(f=>[...f,`⚔ You have ${_myRivs.length} rival${_myRivs.length>1?"s":""}. Type RIVALS to see who.`]),600);
    }
    const myLetters=(normalized.letters||[]).filter(l=>l.to===g.name&&!l.read);
    if(myLetters.length>0){
      setTimeout(()=>setFeed(f=>[...f,`✉ ${myLetters.length} unread letter${myLetters.length>1?"s":""} — type LETTERS to read.`]),400);
    }
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
    // Heartbeat — update lastSeen every 30s + clean stale players (24h)
    const heartbeat=setInterval(()=>{
      const g=gsRef.current;if(!g)return;
      const freshWorld=worldRef?.current;if(!freshWorld)return;
      const cutoff24=Date.now()-(24*60*60*1000);
      const cleanedPlayers=Object.fromEntries(
        Object.entries(freshWorld.players||{}).filter(([n,d])=>
          n===g.name||(d.lastSeen&&d.lastSeen>cutoff24)
        )
      );
      const ws={...freshWorld,players:{...cleanedPlayers,[g.name]:{
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

  // Clock removed — replaced by temperature gauge in header

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
        const dogMentalBoost=p.isDrifter?3:0; // dog keeps you grounded
        const g={...p,survival:{
          hunger:clamp(p.survival.hunger-4,0,100),
          warmth:clamp(p.survival.warmth-warmDrain,0,100),
          health:p.survival.hunger<15?clamp(p.survival.health-5,0,100):p.survival.health,
          energy:clamp(p.survival.energy-2,0,100),
          mental:clamp((p.survival.mental||70)-mentalDrain+mentalBoost+dogMentalBoost,0,100),
        },heat:clamp(p.heat-0.1-safeHeatDrain,0,10)};
        if(g.survival.warmth===0){
          g.survival.health=clamp(g.survival.health-3,0,100);
          setTimeout(()=>setFeed(f=>[...f,`❄️ Freezing. Health dropping. SHELTER NOW.`]),10);
        }
        if(g.survival.hunger===0){
          g.survival.health=clamp(g.survival.health-2,0,100);
          g.survival.energy=clamp(g.survival.energy-5,0,100);
          setTimeout(()=>setFeed(f=>[...f,`🍞 Starving. Body failing. EAT something.`]),10);
        }
        if(g.survival.energy===0){
          g.survival.health=clamp(g.survival.health-1,0,100);
          setTimeout(()=>setFeed(f=>[...f,`😴 Collapsed from exhaustion. REST immediately.`]),10);
        }
        if((g.survival.mental||70)===0){
          g.survival.health=clamp(g.survival.health-2,0,100);
          setTimeout(()=>setFeed(f=>[...f,`🧠 Mind gone. Body following. Get help.`]),10);
        }
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
            trackContract('got_wanted');
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
          const addLvl=getAddictionLevel(g.addiction||0);
          const addFx=addLvl.effects||{};
          // Apply addiction stat penalties to display (not permanent — just active effects)
          if(addFx.energyDrain){
            return{...g,survival:{...g.survival,energy:clamp(g.survival.energy-addFx.energyDrain/60,0,100)}};
          }
          const hasSub=sub?.product&&(g.product[sub.product]||0)>0;
          const addiction=g.addiction||0;
          const daysSinceUse=g.day-(g.lastUsed||0);
          const withdrawThresh=Math.max(1,3-Math.floor(addiction/30));
          const inWithdrawal=daysSinceUse>withdrawThresh&&addiction>20;
          if(inWithdrawal){
            const wEvts=WITHDRAWAL_EVENTS[sub?.name]||WITHDRAWAL_EVENTS.stress;
            const wEvt=wEvts[Math.floor(Math.random()*wEvts.length)];
            const severity=Math.floor(addiction/15);
            setTimeout(()=>setFeed(f=>[...f,"",`🤢 WITHDRAWAL (${getAddictionLevel(addiction).name}):`,wEvt,
              addiction>60?`Hands shaking. Can't think straight. USE to stop this.`:"",
              addiction>80?`⚠ SEVERE — every action costs double energy until you use.`:"",
            ""]),10);
            // Apply withdrawal directly to g (already inside setGs callback)
            g.survival={...g.survival,
              health:clamp(g.survival.health-(severity*5),0,100),
              mental:clamp((g.survival.mental||70)-(severity*8),0,100),
              energy:clamp(g.survival.energy-(severity*10),0,100),
            };
            if(addiction>70&&Math.random()<0.15)g.cash=Math.max(0,g.cash-rnd(10,30));
            if(addiction>80)g.heat=clamp(g.heat+1,0,10);
            g.withdrawalDay=(g.withdrawalDay||0)+1;
            // Junkie story chapter 1 — surviving withdrawal
            if(g.survival.health>0&&g.archetype?.id==="junkie"){
              g.storyFlags=[...new Set([...(g.storyFlags||[]),"survived_withdrawal"])];
            }
          }
          // Rock bottom
          if(addiction>=90&&!hasSub&&daysSinceUse>1&&Math.random()<0.3){
            setTimeout(()=>setFeed(f=>[...f,"","☠ OVERDRAW.",
              "You haven't used. Your body is collecting the debt.",
              "Health dropping. Mental collapsing.",
              "USE · RECOVERY · or die here.",
            ""]),10);
            g.survival={...g.survival,
              health:clamp(g.survival.health-15,0,100),
              mental:clamp((g.survival.mental||70)-20,0,100),
            };
            g.heat=clamp(g.heat+2,0,10);
          } else if(addiction>=95&&!hasSub&&daysSinceUse>1){
            setTimeout(()=>setFeed(f=>[...f,"","☠ Rock bottom.",getAddictionLevel(addiction).desc,"You'd do anything right now. That's the most dangerous place to be.",""]),10);
            g.survival={...g.survival,
              health:clamp(g.survival.health-10,0,100),
              mental:clamp((g.survival.mental||70)-15,0,100),
            };
            g.heat=clamp(g.heat+2,0,10);
          }
        }

        // ── RANDOM STREET ATTACKS ─────────────────────────────────────────────
        // Chance increases with heat, cash carried, and borough danger
        const boroDanger={manhattan:0.06,brooklyn:0.05,bronx:0.07,queens:0.04,staten:0.03};
        const baseAttackChance=(boroDanger[boro]||0.05)+(g.heat/10)*0.04+(g.cash>100?0.02:0);
        if(Math.random()<baseAttackChance){
          const attackType=Math.random();
          if(attackType<0.4){
            const stolen=Math.min(g.cash,rnd(15,Math.min(g.cash,80)));
            if(stolen>0){
              const muggers=["A guy in a hoodie","Two kids","Someone you didn't hear coming","A crackhead moving faster than expected","Three dudes"];
              setTimeout(()=>setFeed(f=>[...f,``,`🔪 ${muggers[rnd(0,muggers.length-1)]} got you. $${stolen} gone.`,`FIGHT to pursue.`,``]),10);
              g.cash=Math.max(0,g.cash-stolen);
            }
          } else if(attackType<0.65){
            const dmg=rnd(8,20);
            const attackMsgs=["Sucker punched from behind. Nobody saw it.","Caught slipping near the corner. Hit once, hard.","Wrong block at the wrong time. Took a shot.","Somebody tested you. Didn't ask permission."];
            setTimeout(()=>setFeed(f=>[...f,``,`🥊 ${attackMsgs[rnd(0,attackMsgs.length-1)]}`,`Health -${dmg}.`,``]),10);
            g.survival={...g.survival,health:clamp(g.survival.health-dmg,0,100)};
          } else if(attackType<0.8){
            const prodKeys=Object.keys(g.product).filter(k=>g.product[k]>0);
            if(prodKeys.length>0){
              const pk=prodKeys[rnd(0,prodKeys.length-1)];
              const qty=Math.min(g.product[pk],rnd(1,2));
              setTimeout(()=>setFeed(f=>[...f,``,`📦 Someone picked your stash. Lost ${qty}x ${pk}.`,``]),10);
              g.product={...g.product,[pk]:Math.max(0,g.product[pk]-qty)};
            }
          } else {
            setTimeout(()=>setFeed(f=>[...f,`Someone rushed you. You moved. Nothing taken. Stay alert.`]),10);
          }
        }
        // Auto-use when product available and addicted (compulsive)
        if(!g.isVampire&&!g.isUndoc){
          const sub2=CLASS_SUBSTANCE[g.archetype?.id||"veteran"];
          const hasSub2=sub2?.product&&(g.product[sub2.product]||0)>0;
          const addiction2=g.addiction||0;
          const useChance=(addiction2/100)*0.18;
          if(hasSub2&&Math.random()<useChance&&addiction2>25){
            const hEvts=HIGH_EVENTS[sub2.name]||HIGH_EVENTS.weed;
            const hEvt=hEvts[Math.floor(Math.random()*hEvts.length)];
            setTimeout(()=>setFeed(f=>[...f,"",`${sub2.icon} You dip into your own stash. Couldn't help it.`,hEvt.msg,""]),10);
            const eff=hEvt.effect||{};
            g.lastUsed=g.day;g.withdrawalDay=0;g.highActive=true;
            g.addiction=Math.min(100,g.addiction+rnd(3,7));
            if(sub2.product)g.product={...g.product,[sub2.product]:Math.max(0,(g.product[sub2.product]||0)-1)};
            if(eff.health)g.survival={...g.survival,health:clamp(g.survival.health+eff.health,0,100)};
            if(eff.mental)g.survival={...g.survival,mental:clamp((g.survival.mental||70)+eff.mental,0,100)};
            if(eff.energy)g.survival={...g.survival,energy:clamp(g.survival.energy+(eff.energy||0),0,100)};
          }
          // Passive addiction creep from handling product
          if(hasSub2&&Math.random()<0.06)g.addiction=Math.min(100,(g.addiction||0)+1);
        }
        const bCopPresence=getCopPresence(boro,world.copPresence,g.day);
        const patrolChance=(g.heat/10)*(bCopPresence/10)*0.3;
        if(Math.random()<patrolChance&&!g.patrolEncountered){
          const evt=PATROL_EVENTS[rnd(0,PATROL_EVENTS.length-1)];
          setTimeout(()=>setFeed(f=>[...f,``,`🚔 ${evt}`,`HIDE · RUN · BRIBE · TALK to respond.`,``]),10);
          g.patrolEncountered=true;
        } else if(g.patrolEncountered){
          g.patrolEncountered=false;
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
            const _deathMsgs=[
              `☠ ${g.name} went down on Day ${g.day}. Level ${g.level}. The city doesn't stop for anyone.`,
              `☠ ${g.name} is gone. Day ${g.day}. They made it to Level ${g.level}. That's something.`,
              `☠ Day ${g.day}. Level ${g.level}. ${g.name} ran out of road. Moment of silence.`,
              `☠ ${g.name} didn't make it. Day ${g.day}. Level ${g.level}. It happens to the best of them.`,
            ];
            const dWs=broadcastActivity(world,_deathMsgs[rnd(0,_deathMsgs.length-1)],"☠");setWorld(dWs);saveWorld(dWs);
            setFeed(f=>[...f,``,`☠ YOU DIED. Day ${g.day}. Level ${g.level}.`]);
            setWorld(prev=>{const ws={...prev,wallOfDead:[...(prev.wallOfDead||[]).slice(-19),{name:g.name,level:g.level,day:g.day,time:Date.now()}]};saveWorld(ws);return ws;});
            setTimeout(()=>setPhase("dead"),2000);
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
        const _lvlMsgs=[
          `${gs.name} just hit Level ${nLvl}. The street is taking notice.`,
          `Level ${nLvl} for ${gs.name}. ${nLvl>=7?"Getting dangerous.":nLvl>=4?"Finding their footing.":"Learning fast."}`,
          `${gs.name} is leveling up. ${nLvl>=8?"Watch out for this one.":"Still hungry."}`,
          `Day ${gs.day}. Level ${nLvl}. ${gs.name} is still standing. Most don't make it this far.`,
        ];
        const lvlWs=broadcastActivity(world,_lvlMsgs[rnd(0,_lvlMsgs.length-1)],"⭐");
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
    const _lastSeen=(world.players||{})[saved.name]?.lastSeen||Date.now();
    const _hoursAway=Math.max(0,Math.floor((Date.now()-_lastSeen)/3600000));
    const _offRpt=_hoursAway>=1?generateOfflineReport(saved,world,_hoursAway):null;
    push(`— WELCOME BACK, ${saved.name} —`,`Day ${saved.day}. Level ${saved.level}. $${saved.cash}.`,`${weather.icon} Today: ${weather.name} — ${weather.desc}`,...(_offRpt&&_offRpt.length>0?[``,`📋 WHILE YOU WERE AWAY (${_hoursAway}h):`,..._offRpt,``]:[]),``,`Type HELP for commands.`);
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
      heat:startHeat,day:1,cornersOwned:[],lastCollect:0,crew:null,crewRole:null,
      storyProgress:{},storyFlags:[],storyKills:0,storyScouts:0,borosVisited:[arch.startBoro||"staten"],
      armyDeployedBoro:{},
      wanted:false,ghostMode:false,habitPaid:false,
      shelterCheckins:{},lastSearch:0,letterWritten:false,prestige:prestige||0,retireEligible:false,
      skills:[],skillPoints:1,
      backstory:backstory||{},journal:[],
      xpMult:driveOpt?.xpMult||1.0,
      activeQuests:{},completedQuests:[],questProgress:{},
      title:"",
      dailySells:{},
      contractsCompleted:[],
      contractProgress:{},
      lifetime:{deals:0,pvpWins:0,panhandles:0,talkCount:0,corners:0,bossKills:0,daysAlive:0,cashEarned:0},
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
      isHooker:arch.id==="hooker",
      regulars:0,
      isDrifter:arch.id==="drifter",
      dogName:arch.id==="drifter"?["Biscuit","Smoke","Patches","Duke","Gus","Lucky","Shadow","Boo"][rnd(0,7)]:null,
      isFixer:arch.id==="fixer",
      isRat:arch.id==="rat",
      thralls:[],feedCount:0,feedUsed:false,
      army:[],armyDeployed:null, // [{id,count,name}]
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
      : arch.id==="hooker"
      ? `You know exactly what this city costs and exactly what you can get for it. CLIENT replaces HUSTLE. Night rates are better. Cops are the real danger.`
      : arch.id==="drifter"
      ? `${state.dogName||"Your dog"} sits at your feet looking up at you. Tail wagging. Ready for whatever comes next.`
      : arch.id==="schizo"
      ? `The city said your name this morning. Out loud. Nobody else heard it. You are used to being the only one who hears things.`
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
    setTimeout(()=>push(
      ``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `📖 DAY ONE`,
      `You just hit the street. No plan. ${startCash>0?"$"+startCash+" to your name.":"Nothing in your pocket."}`,
      `The city doesn't explain itself. We'll walk you through the first hour.`,
      ``,
      `Step 1: `+TUTORIAL_STEPS[0].msg,
      TUTORIAL_STEPS[0].hint||"",
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `🗺 YOUR PATH FORWARD:`,
      `  1. HUSTLE to earn cash`,
      `  2. TALK to NPCs to unlock QUESTS`,
      `  3. CLAIM a corner ($50) then COLLECT income`,
      `  4. HIRE an army to protect it`,
      `  5. Reach Level 3 → WAREHOUSES for big loot`,
      `  6. STORY → your personal class quest chain`,
      ``,
      `Type HELP anytime for a full guide.`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``
    ),300);
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
    const enemyBase=ENEMIES[enemyType];
    if(!enemyBase){push(`⚔ Enemy not found: ${enemyType}. Report this bug.`);return;}
    const enemy={...enemyBase,...{hp:enemyBase.hp,maxHp:enemyBase.hpp}};
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
      newLog.push(`⚔ Attack roll: d20=${attackRoll}`+(advantage?` (adv: ${roll1},${roll2})`:"")+" +"+cs.attackBonus+" = "+totalAttack+" vs AC "+enemy.ac);
      if(miss){
        newLog.push(`  MISS. Fumble.`);
      } else if(crit||totalAttack>=enemy.ac){
        const dmgDice=crit?[roll(6),roll(6),roll(6)]:[roll(6),roll(6)];
        const dmg=dmgDice.reduce((a,b)=>a+b,0)+cs.damageBonus+(crit?4:0);
        enemy={...enemy,hp:Math.max(0,enemy.hp-dmg)};
        newLog.push("  "+(crit?"💥 CRITICAL HIT!":"HIT!")+" "+(crit?"3d6":"2d6")+"="+dmgDice.join("+")+"+"+cs.damageBonus+(crit?" +4 crit":"")+" = "+dmg+" damage. "+enemy.name+" HP: "+enemy.hp+"/"+enemy.maxHp);
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
      const luckBonus=(getItemStats(gs.equipment||{}).luck||0);
      if(dropRoll>=15){
        droppedItem=rollRandomItem(luckBonus);
        if(droppedItem)newLog.push(`  🎁 LOOT DROP: ${itemDropMsg(droppedItem)}`);
      }
      push(...newLog);
      updGs(g=>{
        const ng=applyXP({...g,cash:g.cash+loot-cashCost,
          storyKills:(g.storyKills||0)+1,
          inventory:droppedItem?[...g.inventory,droppedItem]:g.inventory,
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
    newLog.push(``,`HP: ${playerHp} · Enemy HP: ${enemy.hp}/${enemy.maxHp}`,"FIGHT · FLEE"+(availAbils.length?" · USE ["+availAbils.map(a=>a.name).join(" / ")+"]":""));
    setCombat({...combat,enemy,round:round+1,log:newLog,playerHp,advantage:newAdvantage,halfDmg:newHalfDmg,skipEnemyTurn:newSkipEnemy,stunEnemy:newStunEnemy,abilitiesUsed});
    push(...newLog.slice(-8)); // show last 8 lines of combat log in feed
    setAbilityCooldowns(prev=>{const n={};Object.entries(prev).forEach(([k,v])=>{if(v>0)n[k]=v-1;});return n;});
  };

  const handleCmd=(e)=>{
    if(e.key!=="Enter"||!cmd.trim())return;
    const raw=cmd.trim();const C=raw.toUpperCase();
    // / prefix sends directly to chat
    if(raw.startsWith("/")){
      const msgText=raw.slice(1).trim();
      if(!msgText||!gs)return;
      setCmd("");
      const isCrew=raw.startsWith("//");
      const actualText=isCrew?raw.slice(2).trim():msgText;
      if(!actualText)return;
      const entry={from:gs.name,text:actualText,time:Date.now(),boro,arch:gs.archetype?.id||"veteran",crew:isCrew?gs.crew:null};
      const newMsgs2=[...(world.messages||[]).slice(-49),entry];
      const ws={...world,messages:newMsgs2};
      setWorld(ws);setWMsgs(newMsgs2);
      if(isCrew&&gs.crew){
        // crew-only: send via playerAlerts to crew members
        const crewMembers=Object.keys(world.players||{}).filter(n=>world.players[n]?.crew===gs.crew&&n!==gs.name);
        let cws=ws;
        crewMembers.forEach(n=>{cws=notifyPlayers(cws,gs.name,`[CREW] ${gs.name}: ${actualText}`);});
        saveWorld(cws);
        push(`[CREW] You: ${actualText}`);
      } else {
        saveWorld(ws);
        try{sendChatMessage(entry);}catch{}
      }
      return;
    }
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

    // ── DUNGEON / WAREHOUSE RUN COMMANDS ──────────────────────────────────────
    if(dungeon&&dungeon.status==="active"){
      const room=dungeon.rooms[dungeon.currentRoom];
      const isLastRoom=dungeon.currentRoom===dungeon.rooms.length-1;

      // ADVANCE — move to next room
      if(C==="ADVANCE"||C==="NEXT"||C==="FORWARD"){
        if(dungeon.currentRoom>=dungeon.rooms.length){
          push("You've cleared the warehouse. EXTRACT to leave.");return;
        }
        const nextRoom=dungeon.rooms[dungeon.currentRoom];
        push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `ROOM ${dungeon.currentRoom+1}/${dungeon.rooms.length} — ${nextRoom.id.replace(/_/g," ").toUpperCase()}`,
          nextRoom.desc,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
        const ev=nextRoom.event;
        if(ev==="clear"){push("Clear. Nothing here. Move on — ADVANCE.");return;}
        if(ev==="loot_cache"||ev==="loot_cache_small"||ev==="loot_cache_large"||ev==="loot_jackpot"){
          const mult=ev==="loot_jackpot"?3:ev==="loot_cache_large"?2:ev==="loot_cache_small"?0.5:1;
          const cashMin=Math.floor(dungeon.cashRange[0]*mult*dungeon.lootMultiplier);
          const cashMax=Math.floor(dungeon.cashRange[1]*mult*dungeon.lootMultiplier);
          const cash=rnd(cashMin,cashMax);
          const luckBonus=getItemStats(gs.equipment||{}).luck||0;
          const item=rollRandomItem(luckBonus+(ev==="loot_jackpot"?3:0));
          setDungeon(d=>({...d,cashFound:d.cashFound+cash,loot:[...d.loot,item],currentRoom:d.currentRoom+1}));
          push(`💰 Found $${cash} in cash.`,`📦 Loot: ${itemDropMsg(item)}`,``,isLastRoom?"EXTRACT to leave.":"ADVANCE to continue.");
          return;
        }
        if(ev==="fight"||ev==="boss_fight"){
          const enemyKey=nextRoom.enemy||(isLastRoom?"kingpin":"dealer");
          const scaledEnemy={...ENEMIES[enemyKey]};
          // Scale enemy to player level
          const lvDiff=Math.max(0,gs.level-5);
          scaledEnemy.hp=Math.floor((scaledEnemy.hp||20)*(1+lvDiff*0.1));
          scaledEnemy.attackBonus=(scaledEnemy.attackBonus||3)+Math.floor(lvDiff*0.5);
          const isBoss=nextRoom.event==="boss_fight";
          push(`⚔ ${scaledEnemy.name} blocks the way.`,scaledEnemy.desc||"");
          resolveCombat(
            {...gs},
            enemyKey,
            (loot,droppedItem)=>{
              // Win
              const cash=rnd(dungeon.cashRange[0],dungeon.cashRange[1]);
              const luckBonus=getItemStats(gs.equipment||{}).luck||0;
              const bonusItem=isBoss?rollRandomItem(luckBonus+2):null;
              const newLoot=droppedItem?[...dungeon.loot,droppedItem]:[...dungeon.loot];
              if(bonusItem)newLoot.push(bonusItem);
              setDungeon(d=>({...d,cashFound:d.cashFound+cash,loot:newLoot,currentRoom:d.currentRoom+1}));
              push(``,isBoss?`💀 BOSS DOWN.`:`✓ Clear.`,`+$${cash}`,
                bonusItem?`🎁 Boss drop: ${itemDropMsg(bonusItem)}`:"",
                isLastRoom?"EXTRACT to leave with your haul.":"ADVANCE to the next room.");
            },
            ()=>{
              // Lose
              setDungeon(d=>({...d,status:"failed"}));
              push(``,`☠ You went down.`,`Dragged out of the warehouse. Nothing to show for it.`,`Run over.`);
            },
            ()=>{
              // Flee from combat — still in dungeon
              push(`You backed off. Still inside. ADVANCE to try again or EXTRACT to bail.`);
            }
          );
          return;
        }
        if(ev==="fight_two"){
          const enemies=nextRoom.enemies||["thug","thug"];
          push(`⚔ ${enemies.length} enemies. Taking them one at a time.`);
          // Fight first one
          resolveCombat({...gs}, enemies[0],
            ()=>{
              push(`First one down. Second is coming — ADVANCE.`);
              setDungeon(d=>({...d,currentRoom:d.currentRoom})); // stay, second fight pending
            },
            ()=>{setDungeon(d=>({...d,status:"failed"}));push(`Overwhelmed. Run over.`);},
            ()=>{push(`Backed off. ADVANCE to re-engage or EXTRACT.`);}
          );
          return;
        }
        if(ev==="stealth_or_fight"){
          push(`SNEAK to attempt stealth (streetiq check) or FIGHT to engage.`);
          setDungeon(d=>({...d,pendingEvent:nextRoom}));return;
        }
        if(ev==="stealth_or_skip"){
          push(`SNEAK past while they sleep or SEARCH the room.`);
          setDungeon(d=>({...d,pendingEvent:nextRoom}));return;
        }
        if(ev==="skill_check"){
          const stat=nextRoom.stat||"streetiq";const dc=nextRoom.dc||10;
          const statVal=gs.stats?.[stat]||5;
          const d20=roll(20);const total=d20+Math.floor(statVal/2);
          push(`${stat.toUpperCase()} CHECK: d20=${d20}+${Math.floor(statVal/2)}=${total} vs DC${dc}`);
          if(total>=dc){
            const cash=rnd(30,120);
            setDungeon(d=>({...d,cashFound:d.cashFound+cash,currentRoom:d.currentRoom+1}));
            push(`✓ SUCCESS. $${cash} found.`,isLastRoom?"EXTRACT to leave.":"ADVANCE.");
          } else {
            push(`✗ FAIL. Alerted. Moving on — ADVANCE quickly.`);
            updGs(g=>({...g,heat:clamp(g.heat+1,0,10)}));
            setDungeon(d=>({...d,currentRoom:d.currentRoom+1}));
          }
          return;
        }
        if(ev==="npc_choice"){
          push(`Kid says he'll show you the stash for $20. PAY to take the deal or IGNORE.`);
          setDungeon(d=>({...d,pendingEvent:nextRoom}));return;
        }
        // Default: just advance
        setDungeon(d=>({...d,currentRoom:d.currentRoom+1}));
        push(isLastRoom?"EXTRACT to leave.":"ADVANCE to continue.");
        return;
      }

      // SNEAK — stealth past guards
      if(C==="SNEAK"){
        const siq=gs.stats?.streetiq||5;const d20=roll(20);const total=d20+Math.floor(siq/2);const dc=12;
        push(`STEALTH: d20=${d20}+${Math.floor(siq/2)}=${total} vs DC${dc}`);
        if(total>=dc){
          push(`✓ Slipped past. Clear.`);
          setDungeon(d=>({...d,currentRoom:d.currentRoom+1,pendingEvent:null}));
          push(dungeon.currentRoom+1>=dungeon.rooms.length?"EXTRACT to leave.":"ADVANCE.");
        } else {
          push(`✗ Spotted. FIGHT.`);
          resolveCombat({...gs},"thug",
            ()=>{setDungeon(d=>({...d,currentRoom:d.currentRoom+1,pendingEvent:null}));push("Guard down. ADVANCE.");},
            ()=>{setDungeon(d=>({...d,status:"failed"}));push("Run over.");},
            ()=>{push("Fled combat. Still in dungeon. ADVANCE or EXTRACT.");}
          );
        }
        return;
      }

      // PAY — pay snitch NPC
      if(C==="PAY"){
        if(gs.cash<20){push("Need $20.");return;}
        const cash=rnd(80,250);const luckBonus=getItemStats(gs.equipment||{}).luck||0;
        const item=rollRandomItem(luckBonus+1);
        updGs(g=>({...g,cash:g.cash-20}));
        setDungeon(d=>({...d,cashFound:d.cashFound+cash,loot:[...d.loot,item],currentRoom:d.currentRoom+1,pendingEvent:null}));
        push(`Paid $20. Kid leads you to a side room.`,`Found: $${cash} + ${itemDropMsg(item)}`,
          dungeon.currentRoom+1>=dungeon.rooms.length?"EXTRACT.":"ADVANCE.");
        return;
      }

      // IGNORE — skip NPC
      if(C==="IGNORE"){
        setDungeon(d=>({...d,currentRoom:d.currentRoom+1,pendingEvent:null}));
        push("Left the kid there. Moved on.");
        push(dungeon.currentRoom+1>=dungeon.rooms.length?"EXTRACT.":"ADVANCE.");
        return;
      }

      // SEARCH — search current room for bonus loot
      if(C==="SEARCH"&&dungeon){
        const luckBonus=getItemStats(gs.equipment||{}).luck||0;
        if(Math.random()<0.4+luckBonus*0.05){
          const cash=rnd(20,80);
          setDungeon(d=>({...d,cashFound:d.cashFound+cash,currentRoom:d.currentRoom+1,pendingEvent:null}));
          push(`Found $${cash} tucked away.`,dungeon.currentRoom+1>=dungeon.rooms.length?"EXTRACT.":"ADVANCE.");
        } else {
          setDungeon(d=>({...d,currentRoom:d.currentRoom+1,pendingEvent:null}));
          push("Nothing extra here. ADVANCE.");
        }
        return;
      }

      // EXTRACT — exit the warehouse with what you have
      if(C==="EXTRACT"||C==="EXIT"||C==="LEAVE"){
        const d=dungeon;
        const totalCash=d.cashFound;
        const items=d.loot;
        const completed=d.currentRoom>=d.rooms.length;
        setDungeon({...d,status:completed?"complete":"fled"});
        // Award everything
        if(totalCash>0||items.length>0){
          updGs(g=>({...g,
            cash:g.cash+totalCash,
            inventory:[...g.inventory,...items],
            heat:clamp(g.heat+(d.heatOnEnter||0),0,10),
          }));
          updGs(g=>applyXP(g,(completed?150:60)+(d.currentRoom*20),"fight"));
        }
        const roomsCleared=d.currentRoom;
        push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          completed?`✓ WAREHOUSE CLEARED`:`EXTRACTED — ${roomsCleared}/${d.rooms.length} rooms`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          totalCash>0?`💰 Cash: +$${totalCash}`:"",
          ...items.map(i=>`📦 ${itemDropMsg(i)}`),
          items.length===0&&totalCash===0?"Nothing to show for it.":"",
          `Heat +${d.heatOnEnter||0}. XP awarded.`,
          ``,`Cooldown active. Run WAREHOUSES for the list.`);
        // Mark cooldown in gamestate
        updGs(g=>({...g,warehouseCooldowns:{...(g.warehouseCooldowns||{}),[d.warehouseId]:Date.now()}}));
        setDungeon(null);
        return;
      }

      // STATUS — show current dungeon status
      if(C==="STATUS"||C==="WHERE"){
        push(``,`📍 ${dungeon.warehouseName}`,
          `Room ${dungeon.currentRoom+1} of ${dungeon.rooms.length}`,
          `Cash found so far: $${dungeon.cashFound}`,
          `Items: ${dungeon.loot.length}`,
          ``,`ADVANCE · EXTRACT · SEARCH · SNEAK`);
        return;
      }

      // Catch-all while in dungeon
      push(`Inside ${dungeon.warehouseName}. ADVANCE · EXTRACT · STATUS`);return;
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
        // Special broadcast for alien incident
        if(rareEvent.id==="alien_incident"){
          const aWs=broadcastActivity(world,`🛸 Something happened near the ${getBoro(boro)?.name} waterfront. ${gs.name} was there.`,"🛸");
          const aWs2=addWorldHistory(aWs,"alien",gs.name,`${gs.name} witnessed The Incident in ${getBoro(boro)?.name} on Day ${gs.day}.`,boro);
          setWorld(aWs2);saveWorld(aWs2);
          // Captain lays low
          setTimeout(()=>push(``,`The Captain was in ${getBoro(boro)?.name} tonight. After what happened, he's not.`,``),500);
        }
        setRareEvent(null);
        return;
      }
      push(`⚡ You need to respond to the situation first.`,`Type CHOOSE 1${rareEvent.choices?.[1]?" or CHOOSE 2":""}`);
      return;
    }
    const b=getBoro(boro);
    const weEffect=world.worldEvent?.effect||{};
    const regularIncome=(gs.regulars||0)*20;
    const weather=getWeather(gs.day);

    // ABILITIES — show archetype combat abilities
    if(C==="ABILITIES"){
      const archAbilities=COMBAT_ABILITIES[gs.archetype?.id]||[];
      push(`— ${gs.archetype?.name} COMBAT ABILITIES —`,...archAbilities.map(a=>{
        const cd=abilityCooldowns[a.id]||0;
        return "  "+a.name+(cd>0?" (cooldown: "+cd+"r)":"")+" — "+a.desc;
      }),``,`USE [ability name] during combat.`);
      return;
    }
    if(C==="HELP"){
      const lvl=gs.level||1;
      push(``,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `HOBO QUEST  ·  Level ${lvl}  ·  Day ${gs.day}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
      if(lvl<=2){
        push(`📍 WHERE TO START:`,
          `  LOOK      — see the block, earn XP`,
          `  HUSTLE    — make money`,
          `  STATUS    — all your stats`,
          `  BODEGA    — buy food`,
          `  SLEEP     — end the day`,
          ``);
      }
      push(
        `📖 HELP TOPICS — type any of these:`,
        `  HELP MONEY     — hustling, corners, collecting income`,
        `  HELP SURVIVAL  — health, hunger, warmth, addiction`,
        `  HELP COMBAT    — fighting, weapons, army`,
        `  HELP QUESTS    — NPCs, missions, reputation`,
        `  HELP GEAR      — items, loot, equipment`,
        lvl>=3?`  HELP WAREHOUSE — dungeon runs, loot`:"",
        `  HELP WORLD     — multiplayer, crews, PvP`,
        gs.isVampire||gs.isJunkie||gs.isUndoc||gs.isHustler||gs.isFixer||gs.isRat?
          `  HELP CLASS     — your archetype abilities`:
          `  HELP CLASS     — archetype abilities`,
        ``,
        `  HELP ALL       — every command (long)`,
        ``,
        `📖 STORY          — your class storyline & chapter progress`,
      );
      return;
    }

    // ── HELP TOPICS ───────────────────────────────────────────────────────────
    if(C==="HELP MONEY"){
      push(``,`💰 MONEY`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `HUSTLE          — earn cash (cooldown per day)`,
        `BUY [item] [#]  — buy product to resell`,
        `SELL [item] [#] — sell product (prices vary by borough)`,
        `MOVE [borough]  — travel to find better prices`,
        `ARBITRAGE       — shows best buy/sell spread right now`,
        ``,
        `CORNERS (passive income):`,
        `  CLAIM           — take the corner here ($50)`,
        `  CORNERS         — see who owns what, income rates`,
        `  COLLECT         — pocket accrued income (caps at 12h)`,
        `  SLEEP           — auto-drips 25% of daily rate`,
        `  UPGRADE CORNER  — increase income at your corner`,
        ``,
        `PANHANDLE       — small cash, low risk`,
        `WORK / TAKE [job] — legit work at the shelter`,
        `COOK            — craft product, sell for margin`,
      );return;
    }

    if(C==="HELP SURVIVAL"){
      push(``,`❤️ SURVIVAL`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Four bars drain over time. Hit 0 and health drops fast.`,
        ``,
        `HEALTH  — drops when other bars hit zero. 0 = dead.`,
        `HUNGER  — EAT or BODEGA to refill. Starving = -2hp/tick.`,
        `WARMTH  — SHELTER or SLEEP. Freezing = -3hp/tick.`,
        `ENERGY  — REST or SLEEP. Collapsed = -1hp/tick.`,
        `MENTAL  — USE (carefully), REST, SHELTER. 0 = -2hp/tick.`,
        ``,
        `EAT             — consume food from inventory`,
        `BODEGA          — buy food and medical supplies`,
        `REST            — recover energy + health (+10hp free)`,
        `HEAL            — see all health recovery options`,
        `CLINIC          — pay for full medical care (+60hp, $25)`,
        `  BUY ASPIRIN      — +10hp ($3)`,
        `  BUY BANDAGE      — +25hp ($8)`,
        `  BUY FIRST AID KIT — +40hp ($15)`,
        `SHELTER         — find warmth (free shelters available)`,
        `SHELTERS        — list nearby shelters`,
        `SLEEP           — full rest, advance the day`,
        ``,
        `ADDICTION:`,
        `  USE [drug]      — use your substance`,
        `  ADDICTION       — see your current level`,
        `  RECOVERY        — attempt to get clean (hard)`,
        `  Not using causes withdrawal — health/mental damage`,
      );return;
    }

    if(C==="HELP COMBAT"){
      push(``,`⚔ COMBAT`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `FIGHT [name]    — attack an NPC or start PvP`,
        `FIGHT           — (in combat) take your swing`,
        `FLEE            — (in combat) try to escape`,
        `USE [ability]   — (in combat) use archetype skill`,
        ``,
        `Your army protects your corners and helps in fights:`,
        `  HIRE            — see available units + costs`,
        `  HIRE [unit]     — recruit: lookout($80) runner($120)`,
        `                    enforcer($200) lieutenant($400)`,
        `  ARMY            — view your roster + stats`,
        `  DEPLOY [boro]   — station army in a borough`,
        `  FIRE [unit]     — dismiss a unit`,
        ``,
        `ATTACK [player] — challenge another player for their corner`,
        `BOUNTY [name] [amount] — put a bounty on someone`,
        `BOUNTIES        — see active bounties`,
        `HEAT            — your current heat level (0-10)`,
        `LAY LOW         — reduce heat (costs time)`,
        `HIDE / RUN / BRIBE / TALK — respond to cop encounters`,
      );return;
    }

    if(C==="HELP QUESTS"){
      push(``,`📋 QUESTS`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `NPCs give quests. Talk to them first to build rep.`,
        ``,
        `TALK [name]     — talk to an NPC (builds rep)`,
        `NPCS            — list all NPCs in your borough`,
        `QUESTS          — see available quests`,
        `ACCEPT [NPC] [tier] — take a job`,
        `CONTRACT PROGRESS   — check active quest status`,
        ``,
        `NPC names:  RAY · SMOKE · CARLOS · DEE · MARIA`,
        `Each NPC specializes: Ray(deals) Smoke(muscle)`,
        `Carlos(intel) Dee(goods) Maria(community)`,
        ``,
        `WANTED POSTERS  — see who has bounties`,
        `CONTRACTS       — formal multi-step jobs`,
        `LEADERBOARD     — top players this week`,
        `RIVALS          — your tracked rivals`,
      );return;
    }

    if(C==="HELP GEAR"){
      push(``,`🎒 GEAR & LOOT`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Items drop with random stats — no two are alike.`,
        `Rarity: Common → Uncommon → Rare → Legendary`,
        ``,
        `LOOT            — today's black market (4 rolled items)`,
        `BUY MARKET [1-4] — purchase from market`,
        `SCAVENGE        — search area (chance of gear drop)`,
        `SEARCH          — quick look around`,
        ``,
        `INVENTORY / INV — see what you're carrying`,
        `EQUIP [item]    — wear an item`,
        `UNEQUIP [slot]  — take it off (slots: head chest hands feet weapon accessory)`,
        `GEAR            — see equipped stats`,
        `DROP [item]     — discard an item`,
        `INSPECT [item]  — see item details`,
        ``,
        `Loot drops from: combat wins · SCAVENGE · PvP · warehouse runs`,
        `Luck stat increases rarity of drops.`,
      );return;
    }

    if(C==="HELP WAREHOUSE"){
      push(``,`🏭 WAREHOUSE RUNS`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Crew-controlled warehouses. Enter, fight through rooms, take loot.`,
        `Best source of rare/legendary gear.`,
        ``,
        `WAREHOUSES      — see all 5 locations + cooldowns`,
        `ENTER WAREHOUSE — start a run (must be in that borough)`,
        ``,
        `Inside a run:`,
        `  ADVANCE       — move to next room`,
        `  SNEAK         — attempt stealth past guards`,
        `  SEARCH        — look for bonus loot in room`,
        `  PAY           — pay off an NPC for intel/shortcut`,
        `  IGNORE        — skip an NPC encounter`,
        `  STATUS        — see run progress`,
        `  EXTRACT       — leave with what you have`,
        ``,
        `Locations (min level):`,
        ...Object.values(WAREHOUSE_LOCATIONS).map(wh=>
          `  ${wh.name} [${wh.id}] — Level ${wh.minLevel}+`),
        ``,
        `MOVE [borough] to reach a warehouse, then ENTER WAREHOUSE.`,
      );return;
    }

    if(C==="HELP WORLD"){
      push(``,`🌐 MULTIPLAYER & WORLD`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `MSG [text]      — broadcast to world chat`,
        `WRITE [name] [msg] — send a private letter`,
        `LETTERS         — read your mail`,
        ``,
        `Crews:`,
        `  FORM CREW [name] — start a crew`,
        `  JOIN CREW [name] — apply to join`,
        `  CREW            — your crew status`,
        `  CREWS           — all active crews`,
        `  DEPOSIT [amount]— add to crew fund`,
        ``,
        `MARKET          — see global supply/demand`,
        `MAP             — borough map`,
        `HISTORY         — world event log`,
        `NEWSPAPER       — today's street news`,
        `ALERTS          — your notifications`,
        `LEADERBOARD     — weekly rankings`,
        ``,
        `OFFER [player] [product] [qty] [price] — trade offer`,
        `TRADES          — see pending offers`,
      );return;
    }

    if(C==="HELP CLASS"){
      const arch=gs.archetype;
      push(``,`⭐ YOUR CLASS: ${arch?.name||"Unknown"}`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        arch?.desc||"",``);
      if(gs.isVampire)push(`FEED [target]   — drain blood for health`,`MESMERIZE [npc] — control an NPC`,`MIST [borough]  — scouting ability`,`DOMINATE [player] — attempt mind control`,`THRALL [npc]    — bind an NPC`,`NIGHT MARKET    — black market access`,`THIRST          — check hunger level`);
      if(gs.isJunkie)push(`SCORE           — find cheap street product`);
      if(gs.isUndoc)push(`CONNECT         — tap community network`,`VANISH          — emergency heat dump`);
      if(gs.isHustler)push(`FLIP            — arbitrage analysis`);
      if(gs.isFixer)push(`WIRE [player] [amt] — send cash`,`BROKER [p1] [p2] — arrange deals`,`CLEAN [player]  — wash heat`,`CONNECTIONS     — your network`);
      if(gs.isRat)push(`INFORM [player] — tip off cops`,`MISINFORM [player] — plant false intel`,`PLANT [player]  — frame someone`,`EXPOSE [player] — burn a target`,`INTEL           — your collected info`);
      push(``,`SKILLS          — see unlockable abilities`,`SKILL [name]    — unlock a skill`);
      return;
    }

    if(C==="HELP ALL"){
      push(``,`ALL COMMANDS`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `SURVIVAL: LOOK STATUS SLEEP REST EAT BODEGA SHELTER SHELTERS`,
        `MONEY:    HUSTLE BUY SELL COOK ARBITRAGE PANHANDLE WORK TAKE`,
        `CORNERS:  CLAIM CORNERS COLLECT UPGRADE CORNER ABANDON CORNER`,
        `ARMY:     HIRE ARMY DEPLOY FIRE ATTACK BOUNTY BOUNTIES`,
        `GEAR:     INVENTORY LOOT SCAVENGE SEARCH EQUIP UNEQUIP GEAR DROP INSPECT`,
        `QUESTS:   TALK NPCS QUESTS ACCEPT CONTRACTS CONTRACT PROGRESS`,
        `WORLD:    MSG WRITE LETTERS MARKET MAP HISTORY NEWSPAPER ALERTS`,
        `          LEADERBOARD RIVALS OFFER TRADES CREW CREWS FORM JOIN DEPOSIT`,
        `COPS:     HEAT LAY LOW HIDE RUN BRIBE TALK WANTED CHANGE UP SKIP TOWN`,
        `DUNGEON:  WAREHOUSES ENTER WAREHOUSE ADVANCE SNEAK SEARCH PAY EXTRACT`,
        `META:     TITLE RETIRE LEGENDS WALL OF DEAD`,
        gs.isVampire?`VAMPIRE: FEED MESMERIZE MIST DOMINATE THRALL NIGHT MARKET THIRST`:"",
        gs.isJunkie?`JUNKIE: SCORE`:gs.isUndoc?`UNDOC: CONNECT VANISH`:
        gs.isHustler?`HUSTLER: FLIP`:gs.isFixer?`FIXER: WIRE BROKER CLEAN CONNECTIONS`:
        gs.isRat?`RAT: INFORM MISINFORM PLANT EXPOSE INTEL`:"",
        ``,`Type HELP [topic] for details on any category.`);
      return;
    }

    // ── WAREHOUSE COMMANDS ────────────────────────────────────────────────────
    if(C==="WAREHOUSES"||C==="RUNS"||C==="DUNGEON"){
      push(``,`🏭 WAREHOUSE RUNS`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Abandoned warehouses controlled by crews. Enter, clear rooms, take loot.`,
        `Each has a cooldown. Scale up as you level.`,``);
      Object.values(WAREHOUSE_LOCATIONS).forEach(wh=>{
        const cooldown=wh.cooldownH*3600000;
        const lastRun=(gs.warehouseCooldowns||{})[wh.id]||0;
        const ready=Date.now()-lastRun>cooldown;
        const minLeft=ready?0:Math.ceil((cooldown-(Date.now()-lastRun))/60000);
        const inRange=boro===wh.id;
        push(`  ${ready?"✓":"🕐"} ${wh.name} [${wh.short}] — Min Level ${wh.minLevel}`+(ready?"":" ("+minLeft+"m cooldown)"),
          `     ${wh.desc}`,
          `     Cash: $${wh.cashRange[0]}-${Math.floor(wh.cashRange[1]*wh.lootMultiplier*3)} · ${wh.flavor}`,
          inRange&&ready&&gs.level>=wh.minLevel?`     → ENTER WAREHOUSE to run this now.`:"",``);
      });
      push(`ENTER WAREHOUSE to start a run in your current borough.`,
        `You must be in the right borough. MOVE [borough] to travel.`);
      return;
    }

    if(C==="ENTER WAREHOUSE"||C==="ENTER"||C==="RUN WAREHOUSE"){
      if(dungeon){push("Already inside a warehouse. EXTRACT to leave first.");return;}
      if(combat){push("Can't enter a warehouse in combat.");return;}
      const wh=WAREHOUSE_LOCATIONS[boro];
      if(!wh){push(`No warehouse in ${getBoro(boro)?.name}. Try another borough.`);return;}
      if(gs.level<wh.minLevel){push(`Need Level ${wh.minLevel} to run ${wh.name}. You're Level ${gs.level}.`);return;}
      const cooldown=wh.cooldownH*3600000;
      const lastRun=(gs.warehouseCooldowns||{})[boro]||0;
      if(Date.now()-lastRun<cooldown){
        const minLeft=Math.ceil((cooldown-(Date.now()-lastRun))/60000);
        push(`${wh.name} is on cooldown. ${minLeft} more minutes.`);return;
      }
      if(gs.survival.health<25){push("Too hurt to run a warehouse. REST or heal first.");return;}
      if(gs.survival.energy<20){push("Too exhausted. REST first.");return;}
      const luckBonus=getItemStats(gs.equipment||{}).luck||0;
      const run=generateWarehouseRun(boro,gs.level,luckBonus);
      setDungeon(run);
      const firstRoom=run.rooms[0];
      push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `🏭 ${wh.name.toUpperCase()}`,wh.desc,wh.flavor,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``,
        `${run.totalRooms} rooms. Unknown layout. Stay sharp.`,``,
        `ROOM 1/${run.totalRooms} — ${firstRoom.id.replace(/_/g," ").toUpperCase()}`,
        firstRoom.desc,``,
        firstRoom.event==="clear"?"Clear room. ADVANCE to continue.":
        firstRoom.event.includes("fight")?"⚔ Hostile. ADVANCE to engage.":
        firstRoom.event.includes("stealth")?"SNEAK past or FIGHT.":
        firstRoom.event.includes("loot")?"💰 Loot here. ADVANCE to collect.":
        "ADVANCE to proceed.",
        ``,`ADVANCE · SNEAK · SEARCH · STATUS · EXTRACT`);
      updGs(g=>({...g,heat:clamp(g.heat+(wh.heatOnEnter||0),0,10)}));
      return;
    }

    // ── COLLECT — manually collect accrued corner income ──────────────────────
    // Income accrues continuously up to a 12-hour cap. COLLECT pockets it.
    // Separate small passive drip also lands on SLEEP (can't be collected).
    if(C==="COLLECT"||C==="COLLECT INCOME"){
      const owned=gs.cornersOwned||[];
      if(owned.length===0){push("You don't own any corners. CLAIM one first ($50).");return;}
      const now=Date.now();
      const lastCollect=gs.lastCollect||gs.startTime||now;
      const MAX_ACCRUAL_HOURS=12;
      const hoursAccrued=Math.min((now-lastCollect)/(1000*60*60),MAX_ACCRUAL_HOURS);
      const breakdown=[];
      let total=0;
      owned.forEach(bId=>{
        const lvl=world.cornerLevels?.[bId]||0;
        const tier=getCornerTier(bId,gs,world);
        if(tier===CORNER_TIERS.LOST){
          breakdown.push(`  ☠ ${getBoro(bId)?.short}: LOST — RECLAIM to get it back`);return;
        }
        if(tier===CORNER_TIERS.CONTESTED){
          breakdown.push(`  ⚔ ${getBoro(bId)?.short}: CONTESTED — visit or deploy army NOW`);return;
        }
        const dailyRate=getCornerIncome(bId,lvl,gs,world,tier);
        const hourlyRate=dailyRate/24;
        const maxAccrual=Math.floor(hourlyRate*tier.accrualCap);
        const earned=Math.floor(hourlyRate*Math.min(hoursAccrued,tier.accrualCap));
        const fillPct=Math.round((hoursAccrued/tier.accrualCap)*100);
        const safePct=Math.min(fillPct,100);
        const bar="█".repeat(Math.floor(safePct/10))+"░".repeat(10-Math.floor(safePct/10));
        total+=earned;
        breakdown.push(`  ${tier.icon} ${getBoro(bId)?.short} L${lvl} (${tier.name}): [${bar}] ${safePct}% · +$${earned} (cap $${maxAccrual}/${tier.accrualCap}h)`);
      });
      if(total===0){
        push("","💰 CORNER INCOME","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ...breakdown,"",
          "Nothing accrued. Visit corners to set them HOT, or DEPLOY army to earn at 60%.");return;
      }
      updGs(g=>({...g,cash:g.cash+total,lastCollect:now}));
      push("","💰 CORNER INCOME COLLECTED","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ...breakdown,"",
        `Total: +$${total}  (${hoursAccrued.toFixed(1)}h accrued)`,
        `🔥 HOT=full rate  🟡 WARM=60% (army)  ❄️ COLD=10%`,
        `LOOK to refresh corner status · DEPLOY [boro] to station army`);
      return;
    }
    // ── STORY — archetype storyline progress ──────────────────────────────────
    if(C==="STORY"||C==="MY STORY"){
      const arch=gs.archetype?.id||"veteran";
      const story=CLASS_STORIES[arch];
      if(!story){push("No storyline found for your class.");return;}
      const progress=gs.storyProgress||{};
      const completed=progress[arch]||[];
      const chapter=getStoryChapter(gs);
      const totalChapters=story.chapters.length;
      const doneCount=completed.length;
      push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📖 ${story.title}`,
        `${gs.archetype?.name||"YOUR CLASS"} — Chapter ${doneCount+1}/${totalChapters}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
      // Completed chapters
      completed.forEach(cId=>{
        const ch=story.chapters.find(c=>c.id===cId);
        if(ch)push(`  ✓ ${ch.title}`);
      });
      if(!chapter){
        push(``,`★ STORY COMPLETE — you've seen it through.`,
          `Your title has been unlocked. Type TITLE to view.`);
        return;
      }
      // Current chapter
      const ready=gs.level>=chapter.lvlReq;
      const done=isChapterComplete(gs,chapter);
      push(
        ``,`— CURRENT: ${chapter.title} —`,
        chapter.story,``,
        `Objective: ${chapter.task}`,
        ``,
        !ready?`⚠ Requires Level ${chapter.lvlReq}. You are Level ${gs.level}.`:"",
        done?`✓ READY TO COMPLETE — type STORY COMPLETE`:`Progress: ${chapter.task}`,
        chapter.boss?`⚔ Boss encounter: ${chapter.boss.name}. Type FIGHT STORY BOSS when ready.`:"",
        ``,`STORY COMPLETE — claim your reward when objective is done.`);
      return;
    }

    if(C==="STORY COMPLETE"||C==="COMPLETE STORY"){
      const arch=gs.archetype?.id||"veteran";
      const story=CLASS_STORIES[arch];
      if(!story){push("No storyline found.");return;}
      const chapter=getStoryChapter(gs);
      if(!chapter){push("All chapters complete. Your story is written.");return;}
      if(gs.level<chapter.lvlReq){push(`Need Level ${chapter.lvlReq} to complete this chapter.`);return;}
      if(!isChapterComplete(gs,chapter)){push(`Not done yet.\nObjective: ${chapter.task}`);return;}
      // Award rewards
      const r=chapter.reward||{};
      const newCompleted=[...(((gs.storyProgress||{})[arch])||[]),chapter.id];
      updGs(g=>{
        let ng={...g,storyProgress:{...(g.storyProgress||{}),[arch]:newCompleted}};
        if(r.cash)ng={...ng,cash:ng.cash+r.cash};
        if(r.xp)ng=applyXP(ng,r.xp,"story");
        if(r.title)ng={...ng,title:r.title};
        if(r.skill&&!hasSkill(ng,r.skill))ng={...ng,skills:[...(ng.skills||[]),r.skill]};
        if(r.item){const dropped=rollItem(r.item);ng={...ng,inventory:[...ng.inventory,dropped]};}
        return ng;
      });
      const next=story.chapters.find(c=>!newCompleted.includes(c.id)&&c.id!==chapter.id);
      push(``,`★ CHAPTER COMPLETE: ${chapter.title}`,
        chapter.complete,``,
        r.cash?`+$${r.cash}`:"",
        r.xp?`+${r.xp} XP`:"",
        r.title?`Title unlocked: "${r.title}"`:"",
        r.skill?`Skill unlocked: ${r.skill}`:"",
        r.item?`Item dropped — check INVENTORY`:"",
        ``,
        next?`Next chapter unlocks at Level ${next.lvlReq}: "${next.title}"`:"★ Story complete.");
      return;
    }

    // FIGHT STORY BOSS — encounter the current chapter's boss
    if(C==="FIGHT STORY BOSS"||C==="STORY BOSS"){
      const arch=gs.archetype?.id||"veteran";
      const story=CLASS_STORIES[arch];
      const chapter=getStoryChapter(gs);
      if(!chapter?.boss){push("No boss encounter in your current chapter.");return;}
      if(gs.level<chapter.lvlReq){push(`Need Level ${chapter.lvlReq} first.`);return;}
      const b=chapter.boss;
      // Scale boss to player level
      const lvDiff=Math.max(0,gs.level-chapter.lvlReq);
      const scaledEnemy={
        id:b.id, name:b.name, icon:b.icon||"⚔",
        hp:Math.floor(b.hp*(1+lvDiff*0.08)),
        attackBonus:b.attackBonus+Math.floor(lvDiff*0.5),
        desc:b.desc, loot:[],
      };
      push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `${b.icon||"⚔"} ${b.name.toUpperCase()}`,
        b.desc,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,``);
      resolveCombat({...gs},scaledEnemy.id,
        (loot,droppedItem)=>{
          // Mark boss as defeated via story flag
          const flag=`defeated_${b.id}`;
          updGs(g=>{
            let ng={...g,storyFlags:[...(g.storyFlags||[]),flag]};
            if(droppedItem)ng={...ng,inventory:[...ng.inventory,droppedItem]};
            const chapter2=getStoryChapter(ng);
            if(chapter2&&isChapterComplete(ng,chapter2)){
              push(``,`★ Chapter objective complete! Type STORY COMPLETE to claim your reward.`);
            }
            return applyXP(ng,Math.floor(b.hp*2),"fight");
          });
          push(``,`${b.icon||"⚔"} ${b.name} is down.`,
            droppedItem?`Dropped: ${itemDropMsg(droppedItem)}`:"",
            `Type STORY COMPLETE to claim your chapter reward.`);
        },
        ()=>{push(``,`${b.name} beat you this time. Heal up and try again.`);},
        ()=>{push(`You backed off. ${b.name} is still out there.`);}
      );
      return;
    }

    // RECLAIM — take back a corner lost to NPC rivals
    if(C==="RECLAIM"){
      const contestedBoros=Object.keys(world.cornerContested||{}).filter(b=>{
        const owner=world.corners?.[b];
        return !owner||owner===gs.name||(owner&&owner.startsWith("npc_")||NPC_RIVAL_CREWS.some(r=>r.id===owner));
      });
      const lostBoros=(gs.cornersOwned||[]).filter(b=>world.corners?.[b]&&world.corners[b]!==gs.name);
      const allTargets=[...new Set([...contestedBoros,...lostBoros])].filter(b=>getBoro(b));
      if(allTargets.length===0){push("Nothing to reclaim. Type CORNERS to see your corner status.");return;}
      const bId=allTargets.find(b=>b===boro)||allTargets[0];
      const rival=NPC_RIVAL_CREWS.find(r=>r.id===(world.cornerContestedBy||{})[bId]||r.id===world.corners?.[bId]);
      const rivalName=rival?.name||(world.cornerContestedBy||{})[bId]||"rivals";
      if(bId!==boro){push(`Reclaiming ${getBoro(bId)?.name} corner. MOVE ${bId} first, then RECLAIM.`);return;}
      // Fight to reclaim
      const armyBonus=getArmyDefenseBonus(gs.army||[]);
      const rivalPower=rival?.power||3;
      const win=Math.random()<(0.4+(armyBonus*0.05)-(rivalPower*0.05));
      if(win){
        const newWs={...world,
          corners:{...world.corners,[bId]:gs.name},
          cornerContested:{...world.cornerContested},
          cornerContestedBy:{...world.cornerContestedBy},
        };
        delete newWs.cornerContested[bId];
        delete newWs.cornerContestedBy[bId];
        newWs.cornerLastVisit={...world.cornerLastVisit,[gs.name+":"+bId]:gs.day};
        setWorld(newWs);saveWorld(newWs);
        if(!gs.cornersOwned?.includes(bId))updGs(g=>({...g,cornersOwned:[...(g.cornersOwned||[]),bId]}));
        else updGs(g=>g);
        push(``,`🚩 RECLAIMED`,`Ran ${rivalName} off the ${getBoro(bId)?.name} corner.`,`Corner is yours again. 🔥 HOT.`,
          `Visit regularly or DEPLOY army to keep it warm.`,``);
        updGs(g=>applyXP(g,50,"fight"));
      } else {
        updGs(g=>({...g,survival:{...g.survival,health:clamp(g.survival.health-rnd(10,25),0,100)},heat:clamp(g.heat+2,0,10)}));
        push(``,`⚔ FAILED TO RECLAIM`,`${rivalName} held the corner. You took damage.`,`Heal up, DEPLOY army, then try RECLAIM again.`,``);
      }
      return;
    }
    if(C==="WEATHER"){
      push(`${weather.icon} ${weather.name.toUpperCase()}`,weather.desc,
        "Bust rate: "+(weather.bustMult<1?"-"+Math.round((1-weather.bustMult)*100)+"%":weather.bustMult>1?"+"+Math.round((weather.bustMult-1)*100)+"%":"normal"),
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
      const worldEvent=world.worldEvent||null;
      if(worldEvent){push(``,`${worldEvent.icon} WORLD EVENT: ${worldEvent.title}`,worldEvent.desc,``);}
      push(`${b.name} — Day ${gs.day} — ${weather.icon} ${weather.name}`,boroDesc[boro]||"",wPool[rnd(0,wPool.length-1)]);
      updGs(g=>applyXP({...g,lookCount:(g.lookCount||0)+1},1,"look"));
      // Update corner presence — track last visit to each owned corner
      if(gs.cornersOwned?.includes(boro)){
        const pvWs={...world,cornerLastVisit:{...(world.cornerLastVisit||{}),[gs.name+":"+boro]:gs.day}};
        // clear contested status if player visits personally
        if((pvWs.cornerContested||{})[boro]){
          delete pvWs.cornerContested[boro];
          delete (pvWs.cornerContestedBy||{})[boro];
          pvWs.corners={...pvWs.corners,[boro]:gs.name};
          setTimeout(()=>push(`🚩 Back on your corner. Contested status cleared.`),100);
        }
        setWorld(pvWs);saveWorld(pvWs);
        const tier=getCornerTier(boro,{...gs},pvWs);
        const lvl=pvWs.cornerLevels?.[boro]||0;
        const dailyRate=getCornerIncome(boro,lvl,gs,pvWs,CORNER_TIERS.HOT);
        setTimeout(()=>push(`${tier.icon} Corner: ${tier.name} → 🔥HOT  · $${dailyRate}/day accruing now`),150);
      }
      // rare event roll on LOOK
      if(!rareEvent){
        const _isNight=false; // clock removed — night events can happen anytime now
        const triggered=RARE_EVENTS.filter(ev=>{
          if(ev.nightOnly&&!_isNight)return false;
          if(ev.boroughs&&!ev.boroughs.includes(boro))return false;
          return true;
        }).find(ev=>Math.random()<ev.prob);
        if(triggered){
          setTimeout(()=>{
            setRareEvent(triggered);
            const eventDesc=triggered.id==="alien_incident"&&gs.isSchizo?triggered.descSchizo:triggered.id==="alien_incident"&&gs.isDrifter?triggered.descDrifter:triggered.desc;
            const choiceCount=triggered.choices.length;
            push(``,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,`⚡ ${triggered.title.toUpperCase()}`,eventDesc,``,`Type CHOOSE 1${choiceCount>1?" or CHOOSE 2":""}${choiceCount>2?" or CHOOSE 3":""} to respond.`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
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
        "Cash: $"+gs.cash+(gs.cash>MAX_CARRY_CASH?" ⚠ TARGET":"")+(gs.cashStash>0?" · Stashed: $"+gs.cashStash:""),
        `Heat: ${Math.round(gs.heat)}/10 · ${wt.stars>0?"★".repeat(wt.stars):"☆"} ${wt.name}`,
        `Cops here: ${getCopPresence(boro,world.copPresence,gs.day)}/10`,
        `XP: ${gs.xp} · Next: ${xpNext(gs.xp)} · Next stat: +${nextStat.toUpperCase()}`,
        `Product: Weed×${gs.product.weed} Pills×${gs.product.pills} Powder×${gs.product.powder} (weight: ${pw.toFixed(1)}/${MAX_CARRY_WEIGHT})`,
        gs.debtOwed>0?`⚠ DEBT: $${gs.debtOwed} — PAY DEBT`:"",
        gs.isHooker?"Clients today: "+(gs.hustleCount||0)+"/6 · Regulars: "+(gs.regulars||0):!gs.isFixer&&!gs.isRat?"Hustles today: "+(gs.hustleCount||0)+"/"+HUSTLE_DAILY_MAX[gs.archetype?.id||"veteran"]+(gs.hustleBoroLast===boro&&(gs.hustleBoros?.[boro]||0)>=2?" ⚠ SAME BLOCK PENALTY":""):"",
        `Day labor: ${gs.dayJobDone?"Done for today":"Available — type WORK"}`,
        `Crew: ${gs.crew||"solo"}`,
        gs.army?.length?`Army: ${gs.army.length} units · Power ${getArmyPower(gs.army)} · Upkeep $${getArmyUpkeep(gs.army)}/day · Heat +${getArmyHeatMult(gs.army).toFixed(1)}/day`+
          (Object.keys(gs.armyDeployedBoro||{}).length?` · Deployed: ${Object.keys(gs.armyDeployedBoro||{}).map(b=>getBoro(b)?.short).join(",")}`:` · Not deployed — DEPLOY [boro]`):
          `No army. HIRE to protect corners.`,
        gs.cornersOwned.length?
          `Corners (${gs.cornersOwned.length}): `+gs.cornersOwned.map(bId=>{
            const lvl=world.cornerLevels?.[bId]||0;
            const tier=getCornerTier(bId,gs,world);
            const inc=getCornerIncome(bId,lvl,gs,world,tier);
            const contested=(world.cornerContested||{})[bId];
            return `${getBoro(bId)?.short} L${lvl} ${tier.icon}$${inc}/day`+(contested?` ⚠CONTESTED`:"");
          }).join(" · "):
          `No corners. CLAIM one ($50) when you're in a borough.`,
        // Urgent alerts
        ...gs.cornersOwned.filter(b=>{const t=getCornerTier(b,gs,world);return t===CORNER_TIERS.CONTESTED||t===CORNER_TIERS.LOST;}).map(b=>{
          const t=getCornerTier(b,gs,world);const rn=(world.cornerContestedBy||{})[b]||"rivals";
          return `  ⚠ ${getBoro(b)?.name}: ${t.name} — ${rn}. ${t===CORNER_TIERS.LOST?"RECLAIM":"VISIT or DEPLOY army NOW."}`;
        }),
      );return;
    }
    const inspM=C.match(/^INSPECT (.+)$/);
    if(inspM){
      const iNm=inspM[1].trim().toLowerCase();
      const found2=gs.inventory.find(i=>i.toLowerCase().includes(iNm));
      const iDef=found2?BASE_ITEMS.find(d=>d.name.toLowerCase()===found2.toLowerCase()||d.id===found2.toLowerCase()):null;
      if(!found2){push("Not in your inventory. Type INVENTORY to see what you have.");return;}
      const sLines=iDef?Object.entries(iDef.stats||{}).filter(([,v])=>v).map(([k,v])=>"  "+k+": +"+(typeof v==="boolean"?"yes":v)):[];
      push("",(iDef?"["+iDef.rarity.toUpperCase()+"] ":"")+found2,iDef?.desc||"","",...sLines,
        iDef?.slot==="consumable"?"Single use — USE "+found2+" to consume.":iDef?.slot?"Slot: "+iDef.slot+" — EQUIP "+found2+" to wear.":"",
        "");return;
    }
    const dropM2=C.match(/^DROP (.+)$/);
    if(dropM2){
      const dNm=dropM2[1].trim();
      const dFound=gs.inventory.find(i=>i.toLowerCase().includes(dNm.toLowerCase()));
      if(!dFound){push("Don't have that.");return;}
      updGs(g=>({...g,inventory:g.inventory.filter(i=>i!==dFound)}));
      const dropN={msg:gs.name+" dropped "+dFound+" in "+getBoro(boro)?.name+".",icon:"📦",time:Date.now(),droppedItem:dFound,dropBoro:boro};
      const dWs={...world,notifications:[...(world.notifications||[]).slice(-29),dropN]};
      setWorld(dWs);saveWorld(dWs);
      push("Dropped "+dFound+". Someone in "+getBoro(boro)?.name+" might find it.");return;
    }
    if(C==="PICKUP"||C==="PICK UP"){
      const dropped=(world.notifications||[]).filter(n=>n.droppedItem&&n.dropBoro===boro&&(Date.now()-n.time)<3600000);
      if(dropped.length===0){push("Nothing dropped here recently. Try SEARCH or SCAVENGE.");return;}
      const itm=dropped[rnd(0,dropped.length-1)];
      updGs(g=>({...g,inventory:[...g.inventory,itm.droppedItem]}));
      const newN=(world.notifications||[]).filter(n=>n!==itm);
      setWorld({...world,notifications:newN});saveWorld({...world,notifications:newN});
      push("","📦 Found: "+itm.droppedItem,"","");return;
    }
    if(C==="INVENTORY"||C==="INV"){
      const rC={common:"⬜",uncommon:"🟩",rare:"🟦",legendary:"🟨"};
      const iLines=gs.inventory.map(i=>{
        if(typeof i==="object"&&i._rolled){
          const rc=rC[i.rarity]||"⬜";
          const statStr=Object.entries(i.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(" ");
          return "  "+rc+" "+(ITEM_RARITY[i.rarity]?.prefix||"")+i.name+" [EQUIP] ("+statStr+")";
        }
        const d=BASE_ITEMS.find(x=>x.name===i||x.id===i);
        const rc=rC[d?.rarity]||"⬜";
        const tag=d?.slot==="consumable"?"[USE]":d?.slot?"[EQUIP]":"";
        const statStr=d?Object.entries(d.stats||{}).filter(([,v])=>v&&v!==0).map(([k,v])=>"+"+k).join(" "):"";
        return "  "+rc+" "+i+(tag?" "+tag:"")+(statStr?" ("+statStr+")":"");
      });
      const eqLines=Object.entries(gs.equipment||{}).filter(([,v])=>v).map(([slot,itemOrId])=>{
        const d=typeof itemOrId==="object"&&itemOrId._rolled?itemOrId:getItemById(itemOrId);
        const statStr=d?Object.entries(d.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", "):"";
        return "  "+slot+": "+(d?.name||itemOrId)+(statStr?" ["+statStr+"]":"");
      });
      push("Inventory ("+gs.inventory.length+" items):",
        ...iLines,gs.inventory.length===0?"  Nothing. SEARCH or SCAVENGE to find gear.":"",
        "","Equipped:",...(eqLines.length?eqLines:["  Nothing equipped."]),
        "","INSPECT [item] · USE [item] · EQUIP [item] · DROP [item] · LOOT (market)");return;
    }
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
      const sellPrice=mktPrice(boro,pKey,gs.day,weather,world.supply);
      const buyPrice=Math.round(sellPrice*PRODUCTS[pKey].bm);
      const total=buyPrice*qty;
      // hustler sees spread before committing
      if(gs.isHustler){
        const profit=(sellPrice-buyPrice)*qty;
        push(`💵 Spread: Buy $${buyPrice} · Sell $${sellPrice} · Profit if sold here: $${profit}`);
      }
      const maxBuy=gs.isHustler?10:8;
      if(qty>maxBuy){push(`Can't buy ${qty} at once — too conspicuous. Max ${maxBuy} per trip.`);return;}
      if(total>gs.cash){push(`Need $${total}. Have $${gs.cash}.`);return;}
      // hustler gets slight buy discount
      const finalPrice=gs.isHustler?Math.round(total*0.95):total;
      // Low-level buy bust — higher heat = higher chance of getting grabbed during transaction
      const buyBustChance=gs.heat>7?0.12:gs.heat>5?0.06:0;
      if(buyBustChance>0&&Math.random()<buyBustChance){
        const lostQty=Math.ceil(qty/2);
        updGs(g=>({...g,cash:Math.max(0,g.cash-finalPrice),product:{...g.product,[pKey]:Math.max(0,g.product[pKey]+qty-lostQty)},heat:clamp(g.heat+2,0,10)}));
        push(`Deal went sideways. Got ${qty-lostQty}× ${PRODUCTS[pKey].name} but lost ${lostQty} units in the scramble. Heat +2.`);return;
      }
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
      const runnerBonus=(gs.army||[]).filter(u=>u.id==="runner").length;
      const maxSell=gs.isHustler?8:gs.archetype?.id==="ghost"?7:5+runnerBonus;
      if(qty>maxSell){push(`Can't move ${qty} at once. Max ${maxSell} per transaction.`);return;}
      // Daily sell limit — same product, same borough, max 3 transactions
      const sellLogKey=`sells_${boro}_${pKey}`;
      const sellsToday=(gs.dailySells||{})[sellLogKey]||0;
      const maxSellTx=gs.isHustler?5:3;
      if(sellsToday>=maxSellTx){
        push(`Market's dry here. You've moved ${pKey} in ${getBoro(boro)?.name} ${sellsToday} times today.`,`Come back tomorrow or try another borough.`);return;
      }
      if(gs.product[pKey]<qty){push(`Only have ${gs.product[pKey]}.`);return;}
      const price=mktPrice(boro,pKey,gs.day,weather,world.supply);const total=price*qty;
      // Heat scales with quantity AND current borough heat level
      const boroHeatMult=b.heat/8;
      const hg=Math.max(1,Math.round(qty*PRODUCTS[pKey].rm*boroHeatMult));
      // Bust scales with heat, quantity, and borough cop presence
      const copP=getCopPresence(boro,world.copPresence,gs.day)/10;
      const hasLookout=(gs.army||[]).some(u=>u.id==="lookout");
      const bustBase=(qty>=4?0.15:qty>=2?0.08:0.04)*(weEffect.bustMult||1)*(hasLookout?0.7:1);
      const bustChance=(gs.heat>5||copP>0.7)?bustBase*weather.bustMult*(1+copP):0;
      const caught=bustChance>0&&Math.random()<bustChance;
      if(caught){
        const cashTaken=Math.min(gs.cash,rnd(50,150));
        updGs(g=>({...g,
          product:{...g.product,[pKey]:0}, // lose all of this product
          heat:clamp(g.heat+4,0,10),
          cash:Math.max(0,g.cash-cashTaken),
          survival:{...g.survival,mental:clamp((g.survival.mental||70)-10,0,100)},
        }));
        const bustMsgs=[
          "BUSTED. Plainclothes was watching the whole transaction. Product gone. -$"+cashTaken+". Heat +4.",
          "BUSTED. They had the corner covered. You didn't see it. Product seized. -$"+cashTaken+".",
          "BUSTED. Someone on the block called it in. All your "+PRODUCTS[pKey].name+" gone. -$"+cashTaken+".",
        ];
        push("",bustMsgs[rnd(0,bustMsgs.length-1)],"Heat critical. LAY LOW or SKIP TOWN now.","");return;
      }
      const sellLogKey2=`sells_${boro}_${pKey}`;
      updGs(g=>applyXP({...g,
        cash:g.cash+total,
        product:{...g.product,[pKey]:g.product[pKey]-qty},
        heat:clamp(g.heat+hg,0,10),
        dailySells:{...(g.dailySells||{}),[sellLogKey2]:((g.dailySells||{})[sellLogKey2]||0)+1},
        lifetime:{...g.lifetime,deals:(g.lifetime?.deals||0)+qty,cashEarned:(g.lifetime?.cashEarned||0)+total},
      },8*qty,"deal"));
      // update world supply data so prices respond
      // Supply tracking — accumulates per borough per product per day
      const supplyKey=`${boro}_${pKey}_d${gs.day}`;
      const todaySupply=(world.supply||{})[supplyKey]||0;
      const supplyWs={...world,supply:{...(world.supply||{}),[supplyKey]:todaySupply+qty}};
      const _sellMsgs={
        weed:[
          `${gs.name} just cleared ${qty} bags in ${getBoro(boro)?.name}. Block is moving.`,
          `${qty} bags of green changed hands in ${getBoro(boro)?.name}. ${gs.name} walking away clean.`,
          `${gs.name} is working the ${getBoro(boro)?.name} corners. Weed money.`,
        ],
        pills:[
          `${gs.name} running pills through ${getBoro(boro)?.name}. ${qty} packs. Clean and quick.`,
          `Medical-grade in ${getBoro(boro)?.name}. ${gs.name} moved ${qty} packs. +$${total}.`,
          `${gs.name} found buyers in ${getBoro(boro)?.name}. Pills moving fast today.`,
        ],
        powder:[
          `Heavy product in ${getBoro(boro)?.name}. ${gs.name} just moved ${qty} grams. +$${total}.`,
          `${gs.name} locked down a powder deal in ${getBoro(boro)?.name}. ${qty} units. Real money.`,
          `${getBoro(boro)?.name} powder game is active. ${gs.name} just got paid.`,
        ],
      };
      const _sellPool=_sellMsgs[pKey]||[`${gs.name} moved ${qty}x ${PRODUCTS[pKey].name} in ${getBoro(boro)?.name}.`];
      const actWs=broadcastActivity(supplyWs,_sellPool[rnd(0,_sellPool.length-1)],"💊");
      setWorld(actWs);saveWorld(actWs);
      const archSub=CLASS_SUBSTANCE[gs.archetype?.id||"veteran"];
      if(archSub?.product===pKey){updGs(g=>({...g,addiction:Math.min(100,g.addiction+rnd(1,3))}));}
      trackContract("sell",{product:pKey,qty,boro});
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

    // CLIENT — hooker-specific income command
    if(C==="CLIENT"){
      if(!gs.isHooker){push(`That's not how you operate. Try HUSTLE.`);return;}
      if(gs.survival.energy<15){push(`Too tired. You need to rest first.`);return;}
      const clientsToday=gs.hustleCount||0;
      const maxClients=6;
      if(clientsToday>=maxClients){push(`You've hit your limit for today. Come back tomorrow.`);return;}
      const isNight=(gs.day%2===0); // alternate day/night cycle
      const nightBonus=isNight?1.4:1.0;
      const charmMod=Math.floor((gs.stats?.charm||10)/2);
      const basePay=rnd(30,70);
      const total=Math.round(basePay*nightBonus+charmMod);
      const heatGain=rnd(1,2);
      // Cop chance — higher heat = higher risk
      const copChance=gs.heat>6?0.25:gs.heat>4?0.15:0.08;
      if(Math.random()<copChance){
        const hasCopSense=(gs.skills||[]).includes("read_the_room");
        if(hasCopSense){
          push(`💄 You sensed it before they said a word. Badge under the jacket. Wrong shoes.`,`You walked. Heat +1.`);
          updGs(g=>({...g,heat:clamp(g.heat+1,0,10),hustleCount:(g.hustleCount||0)+1}));
        } else {
          push(`💄 The client was a cop. BUSTED. Heat +3. -$30.`);
          updGs(g=>({...g,heat:clamp(g.heat+3,0,10),cash:Math.max(0,g.cash-30),hustleCount:(g.hustleCount||0)+1}));
        }
        return;
      }
      const clientMsgs=[
        "Business transaction. Clean. $"+total+" in hand.",
        "Regular energy. The kind of client who doesn't make eye contact. $"+total+".",
        "Midtown suit. Nervous. Tips well. $"+total+".",
        "You made it quick. Got what you needed. $"+total+".",
        isNight?"Night rate. The Stroll is good to you tonight. $"+total+".":"Afternoon. Quiet block. $"+total+".",
      ];
      updGs(g=>applyXP({...g,
        cash:g.cash+total,
        heat:clamp(g.heat+heatGain,0,10),
        hustleCount:(g.hustleCount||0)+1,
        clientCount:(g.clientCount||0)+1,
        survival:{...g.survival,energy:clamp(g.survival.energy-20,0,100),mental:clamp((g.survival.mental||70)-5,0,100)},
      },12,"hustle"));
      push(`💄 ${clientMsgs[rnd(0,clientMsgs.length-1)]}`,`+$${total}. Heat +${heatGain}. Energy -20.`);
      return;
    }
    if(C==="HUSTLE"){
      if(gs.isHooker){push(`You don't hustle like that. Type CLIENT.`);return;}
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
            "+$"+base+(payoutMult<1?" ("+Math.round(payoutMult*100)+"% — block's drying up)":""),
            attemptsLeft>0?`${attemptsLeft} hustle${attemptsLeft>1?"s":""} left today.`:`Last hustle today. Rest or move.`);
        }
        const hg=sameBoroPenalty?style.heatRate+HUSTLE_SAME_BORO_HEAT:style.heatRate;
        updGs(g=>applyXP({...g,
          cash:g.cash+base,
          heat:clamp(g.heat+rnd(0,hg),0,10),
          hustleCount:(g.hustleCount||0)+1,
          hustleBoroLast:boro,
          hustleBoros:{...(g.hustleBoros||{}),[boro]:((g.hustleBoros||{})[boro]||0)+1},
          storyHustleCash:(g.storyHustleCash||0)+base,storyOneDayCash:g.hustleBoroLast&&g.lastHustleDay===g.day?(g.storyOneDayCash||0)+base:base,lastHustleDay:g.day,
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
      const hasStreetMedic=hasSkill(gs,"street_medic");
      const restHealthBonus=hasStreetMedic?25:10; // meaningful heal on rest
      const restBonus=gs.isUndoc?restHealthBonus-5:restHealthBonus;
      updGs(g=>applyXP({...g,survival:{
        hunger:clamp(g.survival.hunger-8,0,100),
        warmth:clamp(g.survival.warmth+15,0,100),
        health:clamp(g.survival.health+restBonus,0,100),
        energy:clamp(g.survival.energy+40,0,100),
        mental:clamp((g.survival.mental||70)+5,0,100),
      },heat:clamp(g.heat-1,0,10)},3,"rest"));
      push(gs.isUndoc?`Found a community spot. Laid low.`:`Found cover. Laid low.`,
        `Health +${restBonus} · Energy up · Heat cooling.`,
        gs.survival.health<40?`Still hurting. BUY BANDAGE at the bodega, or CLINIC for serious wounds.`:"");
      return;
    }

    // HEAL — check options and heal up
    if(C==="HEAL"||C==="PATCH UP"){
      const h=gs.survival.health;
      if(h>=90){push(`You're fine. Health at ${h}%.`);return;}
      // Check inventory for healing items
      const healItems=gs.inventory.filter(i=>{
        const base=typeof i==="string"?BASE_ITEMS.find(b=>b.name===i||b.id===i):i._rolled?null:BASE_ITEMS.find(b=>b.id===i);
        return base?.effect?.heal||base?.effect?.health;
      });
      push(``,`🩹 HEAL OPTIONS`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `Current health: ${h}%`,``,
        `Available:`,
        `  REST              — +${hasSkill(gs,"street_medic")?25:10} health (free, slows you down)`,
        `  BUY BANDAGE       — +25 health ($8 at bodega)`,
        `  BUY FIRST AID KIT — +40 health ($15 at bodega)`,
        `  BUY ASPIRIN       — +10 health ($3)`,
        `  CLINIC            — full heal, costs money`,
        healItems.length>0?`  USE [item]        — use a healing item from your inventory`:"",
        gs.isVampire?`  FEED [target]     — drain health from a target`:"",
        gs.archetype?.id==="drifter"?`  Your dog can find help. Try SCOUT with your dog.`:"",
        `  SLEEP             — heals ~20 health overnight`,
        ``,`BODEGA to see food/medical items.`);
      return;
    }

    // CLINIC — pay for medical care
    if(C==="CLINIC"||C==="HOSPITAL"||C==="DOCTOR"){
      if(gs.isUndoc){push(`Can't risk a clinic. No papers. Try BUY BANDAGE or REST.`);return;}
      if(gs.isVampire){push(`Clinics don't help what you have. FEED instead.`);return;}
      const h=gs.survival.health;
      if(h>=95){push(`Doc says you're fine. Don't waste the money.`);return;}
      const cost=gs.heat>=7?40:25; // higher heat = cops might be watching the clinic
      if(gs.cash<cost){push(`Clinic costs $${cost}. You have $${gs.cash}. BUY ASPIRIN or BANDAGE instead.`);return;}
      const healed=Math.min(100,h+60);
      updGs(g=>({...g,cash:g.cash-cost,survival:{...g.survival,health:healed,mental:clamp((g.survival.mental||70)+10,0,100)}}));
      push(``,`🏥 STREET CLINIC`,
        `Paid $${cost}. They don't ask questions.`,
        `Cleaned up. Wrapped up. Told to take it easy.`,
        `Health: ${h}% → ${healed}%.`,
        gs.heat>=7?`The nurse gave you a look. Someone might have made a call.`:`Nobody paid attention. Good.`);
      if(gs.heat>=7)updGs(g=>({...g,heat:clamp(g.heat+1,0,10)}));
      return;
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
    const bodbuyM=C.match(/^BUY (COFFEE|SANDWICH|CHIPS|WATER|BEER|CIGARETTES|ASPIRIN|SOUP|METROCARD|ENERGYDRINK|HOTDOG|LARGE COFFEE|ENERGY DRINK|HOT DOG|LARGE|BANDAGE|FIRST AID KIT|FIRST AID|NEOSPORIN|THUNDERBIRD|FORTYWINE)$/);
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
      const weedP=mktPrice(boro,"weed",gs.day,weather,world.supply);
      const pillsP=mktPrice(boro,"pills",gs.day,weather,world.supply);
      const powderP=mktPrice(boro,"powder",gs.day,weather,world.supply);
      const weedBase=getBoro(boro)?.base?.weed||80;
      const trend=(p,base)=>p>base*1.1?"📈":p<base*0.9?"📉":"→";
      push(`Intel — ${b.name} ${weather.icon}:`,
        `  Weed $${weedP}/bag ${trend(weedP,weedBase)}`,`  Pills $${pillsP}/pack ${trend(pillsP,getBoro(boro)?.base?.pills||12)}`,
        `  Powder $${mktPrice(boro,"powder",gs.day,weather)}/g`,
        `  Corner: ${world.corners?.[boro]||"unclaimed"}`,"  Safe house: "+(world.safehouses?.[boro]?"owned by "+(world.safehouses[boro].owner||world.safehouses[boro].crewOwner):"none"));
      updGs(g=>applyXP({...g,storyScouts:(g.storyScouts||0)+1},8,"scout"));return;
    }

    // MOVE — blizzard/storm adds energy penalty
    const mvM=C.match(/^MOVE (.+)$/);
    if(mvM){
      const _mvIn=mvM[1].toLowerCase().replace(/^the /,'').trim();const t=BOROUGHS.find(bx=>bx.name.toLowerCase().includes(_mvIn)||bx.id===_mvIn||bx.short.toLowerCase()===_mvIn||_mvIn.includes(bx.id));
      if(!t){push(`Unknown borough.`);return;}if(t.id===boro){push(`Already in ${t.name}.`);return;}
      const penalty=10+weather.movePenalty;
      if(gs.survival.energy<penalty){push(`Too tired to travel. Need ${penalty} energy. REST first.`);return;}
      setBoro(t.id);
      updGs(g=>({...g,borosVisited:[...new Set([...(g.borosVisited||[]),t.id])]}));
      const wPool=weather.id==="blizzard"?EVTS.blizzard:weather.id==="rain"||weather.id==="storm"?EVTS.rain:EVTS.normal;
      // Entry check for high wanted tier or restricted boroughs
      const tier2=getWantedTier(Math.round(gs.heat));
      if(tier2.cantEnter.includes(t.id)){
        push(`🚔 You're too hot for ${t.name}. Wanted tier: ${tier2.name}.`,`Cool down first or find another route.`);return;
      }
      // Product weight penalty on move
      const moveWeight=getCarryWeight(gs.product);
      const weightPenalty=Math.floor(Math.max(0,moveWeight-MAX_CARRY_WEIGHT)*3);
      const transitMult=weEffect.moveCostMult||1;
      const totalMovePenalty=weEffect.metrocardDisabled?Math.round((10+weather.movePenalty+weightPenalty+(tier2.movePenalty||0))*transitMult):gs.hasMetrocard?0:Math.round((10+weather.movePenalty+weightPenalty+(tier2.movePenalty||0))*transitMult);
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
      push("You head to "+t.name+(weather.movePenalty>0?" Rough going in this weather.":""),wPool[rnd(0,wPool.length-1)]);
      updGs(g=>{const np={...g.questProgress};Object.keys(g.activeQuests||{}).forEach(qid=>{const v=np[qid]?.visited||[];if(!v.includes(t.id))np[qid]={...(np[qid]||{}),visited:[...v,t.id]};});return{...g,questProgress:np};});
      updGs(g=>applyXP({...g,survival:{...g.survival,energy:clamp(g.survival.energy-penalty,0,100)}},5,"move"));
      const ws={...world,players:{...(world.players||{}),[gs.name]:{level:gs.level,borough:t.id,lastSeen:Date.now(),heat:Math.round(gs.heat)}}};
      setWorld(ws);saveWorld(ws);return;
    }

    // CLAIM — take a corner (must fight owner first if occupied)
    if(C==="CLAIM"){
      const cur=world.corners?.[boro];
      if(cur===gs.name){
        // Already own it — show status
        const lvl=world.cornerLevels?.[boro]||0;
        const lastVisit=world.cornerLastVisit?.[gs.name+":"+boro]||0;
        const daysSince=gs.day-lastVisit;
        const cold=daysSince>CORNER_PRESENCE_DAYS;
        const inc=getCornerIncome(boro,lvl,gs);
        push("","🚩 "+b.name.toUpperCase()+" CORNER — YOURS",
          "Level: "+lvl+" of 3 · Daily income: $"+inc+(cold?" (COLD — visit more)":""),
          "Upgrade cost: "+(lvl<3?"$"+CORNER_UPGRADE_COST[lvl+1]:"MAX LEVEL"),
          cold?"⚠ You haven't been here in "+daysSince+" days. Corner going cold.":"Last visit: Day "+lastVisit+". Active.",
          "","UPGRADE CORNER — spend cash to increase income","ABANDON CORNER — release it");
        return;
      }
      if(cur){
        // Occupied — need to beat owner
        push("🚩 "+cur+" owns this corner.","You need to beat them in a fight first.","ATTACK "+cur+" while in this borough — then CLAIM.");
        return;
      }
      // Claim requirement — hustle+level gate
      if(gs.stats.hustle+gs.level<8){push("Not repped up enough to claim a corner. Keep leveling.");return;}
      // Heat check — can't claim if too hot
      if(gs.heat>7){push("Too hot right now. Cool down before claiming corners. Cops are watching.");return;}
      // Claim it
      let ws=addWorldHistory(world,"corner",gs.name,gs.name+" claimed "+getBoro(boro)?.name+" corner",boro);
      ws=notifyPlayers(ws,gs.name,"🚩 "+gs.name+" just claimed "+getBoro(boro)?.name+" corner.");
      const _cMsgs=[
        gs.name+" just claimed the "+getBoro(boro)?.name+" corner. It's theirs now.",
        getBoro(boro)?.name+" corner changed hands. "+gs.name+" put their flag on it.",
        gs.name+" is running "+getBoro(boro)?.name+". Corner secured. Don't test it.",
      ];
      ws=broadcastActivity(ws,_cMsgs[rnd(0,_cMsgs.length-1)],"🚩");
      if(ws.corners?.[boro]&&ws.corners[boro]!==gs.name)trackContract('corner_steal');
      ws={...ws,
        corners:{...ws.corners,[boro]:gs.name},
        cornerLevels:{...(ws.cornerLevels||{}),[boro]:0},
        cornerLastVisit:{...(ws.cornerLastVisit||{}),[gs.name+":"+boro]:gs.day},
      };
      setWorld(ws);saveWorld(ws);setWMsgs(ws.messages||[]);
      updGs(g=>applyXP({...g,cornersOwned:[...g.cornersOwned,boro],lifetime:{...g.lifetime,corners:(g.lifetime?.corners||0)+1}},30,"claim"));
      const baseInc=getCornerIncome(boro,0,gs);
      push("","🚩 CORNER CLAIMED: "+b.name,
        "Daily income: $"+baseInc+"/day (paid on SLEEP)",
        "Keep showing up — you need to visit every "+CORNER_PRESENCE_DAYS+" days or it goes cold.",
        "UPGRADE CORNER to increase income (costs $"+CORNER_UPGRADE_COST[1]+")",
        "Others can take this by beating you in a fight here.","");
      journalEvent('firstCorner',boro);return;
    }

    // UPGRADE CORNER — spend cash to level up income
    if(C==="UPGRADE CORNER"||C==="UPGRADE"){
      if(!gs.cornersOwned?.includes(boro)){push("You don't own the "+b.name+" corner.");return;}
      const lvl=world.cornerLevels?.[boro]||0;
      if(lvl>=3){push("Corner is already max level. Income: $"+getCornerIncome(boro,3,gs)+"/day.");return;}
      const cost=CORNER_UPGRADE_COST[lvl+1];
      if(gs.cash<cost){push("Need $"+cost+" to upgrade. Have $"+gs.cash+".");return;}
      const newLvl=lvl+1;
      const ws={...world,cornerLevels:{...(world.cornerLevels||{}),[boro]:newLvl}};
      setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,cash:g.cash-cost}));
      const newInc=getCornerIncome(boro,newLvl,gs);
      push("","🚩 CORNER UPGRADED",""+b.name+" corner → Level "+newLvl,
        "New daily income: $"+newInc+"/day",
        newLvl<3?"Next upgrade: $"+CORNER_UPGRADE_COST[newLvl+1]:"MAX LEVEL reached.","");
      return;
    }

    // ABANDON CORNER — release ownership
    if(C==="ABANDON CORNER"||C==="ABANDON"){
      if(!gs.cornersOwned?.includes(boro)){push("You don't own this corner.");return;}
      const ws={...world,corners:{...(world.corners||{})}};
      delete ws.corners[boro];
      setWorld(ws);saveWorld(ws);
      updGs(g=>({...g,cornersOwned:g.cornersOwned.filter(b=>b!==boro)}));
      push("You walked away from the "+b.name+" corner. It's open now.");
      return;
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
      trackContract(isBossWin?'boss_win':'fight_win');
      if(isBossWin)updGs(g=>({...g,lifetime:{...g.lifetime,bossKills:(g.lifetime?.bossKills||0)+1}}));
            // Boss drops loot
      if(isBossWin){
        const bossDrops={
          boss_iceman:  ["Police Scanner","Encrypted Phone","Burner Phone"],
          boss_duchess: ["Deal Ledger","Brass Knuckles","Cuban Link"],
          boss_prophet: ["Ray's Flask","Street Notebook","Pain Pills"],
          boss_ghost:   ["Shadow Hood","Lock Picks","Night Vision Monocle"],
          boss_mama:    ["Marta's Kit","Pawn Shop Watch","Gold Rings"],
          boss_cole:    ["Army Jacket","Dog Tags","Spiked Bat"],
          boss_captain: ["Police Scanner","Kevlar Vest","The Piece"],
        };
        const drops=bossDrops[enemyType]||["Street Bandage"];
        const drop=drops[rnd(0,drops.length-1)];
        updGs(g=>({...g,inventory:[...g.inventory,drop]}));
        setTimeout(()=>push("","📦 LOOT: "+drop,"Taken from "+ENEMIES[enemyType].name+".",""),200);
      }
      const endMsgs=isBossWin?[ENEMIES[enemyType].winMsg||"Boss down."]:["Over. You walk away.","Done. They will not try that again.","You end it before it gets worse."];
      push("",endMsgs[rnd(0,endMsgs.length-1)]);
      if(isBossWin){
        const _bossMsgs=[
          `👹 ${gs.name} just took down ${ENEMIES[enemyType].name} in ${getBoro(boro)?.name}. BOSS DOWN. How.`,
          `👹 ${ENEMIES[enemyType].name} went down in ${getBoro(boro)?.name}. ${gs.name} did what most people can't.`,
          `👹 BOSS FELL. ${gs.name} dropped ${ENEMIES[enemyType].name} in ${getBoro(boro)?.name}. The block is talking about it.`,
        ];
        const bWs=broadcastActivity(world,_bossMsgs[rnd(0,_bossMsgs.length-1)],"👹");
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
      if(!tData){push(tName+" is not in this world.");return;}
      // Check if target has army deployed here
      if(tData.armyDeployed===boro){
        const tArmy=tData.army||[];
        if(tArmy.length>0){push("⚠ "+tName+" has "+tArmy.length+" unit"+(tArmy.length>1?"s":"")+" deployed in "+b.name+". Defense +"+getArmyDefenseBonus(tArmy)+". Expect resistance.");}
      }
      if(tData.armyDeployed===boro){
        const tArmy=tData.army||[];
        if(tArmy.length>0)push("⚠ "+tName+" has army deployed in "+b.name+". Defense +"+getArmyDefenseBonus(tArmy)+". Expect resistance.");
      }
      if(world.corners?.[boro]===tName&&(Date.now()-(tData.lastSeen||0))<120000&&tData.borough===boro){
        push("⚠ "+tName+" is online and defending their "+getBoro(boro)?.name+" corner. They know you're coming.");
      }
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
        // Chance to steal an item on PvP win
        if(won&&(tData.inventory||[]).length>0&&Math.random()<0.3){
          const stealable=(tData.inventory||[]).filter(i=>{const n=typeof i==="object"?i.name:i;return !["Oregon Trail Medal","Rope","Waterproof Bag","Raft Materials"].includes(n);});
          if(stealable.length>0){const si2=stealable[rnd(0,stealable.length-1)];updGs(g=>({...g,inventory:[...g.inventory,si2]}));setTimeout(()=>push("📦 Also grabbed: "+(typeof si2==="object"?si2.name:si2)+" from "+tName+"."),150);}
        }
        // Bonus: 20% chance to drop a random rolled item on PvP win
        if(won&&Math.random()<0.2){
          const pvpDrop=rollRandomItem(getItemStats(gs.equipment||{}).luck||0);
          updGs(g=>({...g,inventory:[...g.inventory,pvpDrop]}));
          setTimeout(()=>push("💀 Street tax: "+itemDropMsg(pvpDrop)),200);
        }
        if(won&&bAmt2>0){
          const bc3={...world.bounties};delete bc3[tName];
          const bcW3=broadcastActivity({...world,bounties:bc3},[gs.name+" collected $"+bAmt2+" bounty on "+tName+".",tName+"'s bounty cleared. "+gs.name+" got $"+bAmt2+"."][rnd(0,2)]||gs.name+" collected the bounty.","💰");
          setWorld(bcW3);saveWorld(bcW3);
          updGs(g=>({...g,cash:g.cash+bAmt2}));
          push("💰 Bounty collected! +$"+bAmt2+".");
        }
         const ws={...world,pvpLog:[...(world.pvpLog||[]).slice(-29),{attacker:gs.name,victim:tName,won,stolen,boro,time:Date.now()}],
        corners:{...world.corners,...(cornerStolen?{[boro]:gs.name}:{})},
        playerAlerts:{...(world.playerAlerts||{}),[tName]:[...((world.playerAlerts||{})[tName]||[]),
          {msg:"⚠ "+gs.name+" attacked you in "+b.name+". Attack roll "+totalAttack+". "+(won?"Lost $"+stolen+".":"They missed."),time:Date.now()}]}};
      // Track rivals — attacked same player twice = rivalry
      const rivalKey=gs.name+":"+tName;
      const attackCount=((world.rivals||{})[rivalKey]||0)+1;
      const newRivals={...(world.rivals||{}),[rivalKey]:attackCount};
      if(attackCount===2){
        setTimeout(()=>push("","⚔ RIVALRY DECLARED","You and "+tName+" are now rivals. Beating them gives 2x XP and cash.","They've been notified.",""),300);
        const rivWs2={...world,rivals:newRivals};
        const rivWs3=notifyPlayers(rivWs2,gs.name,"⚔ "+gs.name+" has declared you a rival. Watch your back.");
        const ws={...rivWs3,
          pvpLog:[...(rivWs3.pvpLog||[]).slice(-29),{attacker:gs.name,victim:tName,won,stolen,boro,time:Date.now()}],
          playerAlerts:{...(rivWs3.playerAlerts||{}),[tName]:[...((rivWs3.playerAlerts||{})[tName]||[]),{msg:"⚠ "+gs.name+" attacked you in "+b.name+". "+( won?"Lost $"+stolen+".":"They missed."),time:Date.now()}]},
          rivals:newRivals,
        };
        setWorld(ws);saveWorld(ws);
        if(won){
          const _isRival=attackCount>=2;
          const _rMult=_isRival?2:1;
          updGs(g=>applyXP({...g,
            cash:g.cash+stolen*_rMult,
            heat:clamp(g.heat+hg,0,10),
            survival:{...g.survival,health:clamp(g.survival.health-selfDmg,0,100)},
            cornersOwned:cornerStolen?[...g.cornersOwned,boro]:g.cornersOwned,
            lifetime:{...(g.lifetime||{}),pvpWins:(g.lifetime?.pvpWins||0)+1},
          },25*_rMult,"fight"));
          if(_isRival)push("⚔ RIVAL BONUS: 2x XP and cash.");
        }
        let wsh=addWorldHistory(world,"pvp",gs.name,`${gs.name} robbed ${tName} in ${getBoro(boro)?.name} (d20=${attackRoll}, +$${stolen})`,boro);
        wsh=notifyPlayers(wsh,gs.name,`🔴 ${gs.name} rolled ${attackRoll} attacking ${tName} in ${getBoro(boro)?.name}. +$${stolen}.`);
        const _pvpWinMsgs=[
          `${gs.name} ran up on ${tName} in ${getBoro(boro)?.name}. $${stolen} lighter now.`,
          `${tName} got taxed in ${getBoro(boro)?.name}. ${gs.name} collected $${stolen}.`,
          `${gs.name} and ${tName} had words in ${getBoro(boro)?.name}. Only one walked away with their cash.`,
        ];
        const _pvpLoseMsgs=[
          `${gs.name} stepped to ${tName} in ${getBoro(boro)?.name}. Didn't go as planned.`,
          `${gs.name} swung on ${tName} in ${getBoro(boro)?.name}. ${tName} held their ground.`,
          `Bad read in ${getBoro(boro)?.name}. ${gs.name} came up short against ${tName}.`,
        ];
        const _pvpPool=won?_pvpWinMsgs:_pvpLoseMsgs;
        wsh=broadcastActivity(wsh,_pvpPool[rnd(0,_pvpPool.length-1)],"⚔");
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
    // CONTRACTS — daily contract board
    if(C==="CONTRACTS"||C==="CONTRACT BOARD"||C==="BOARD"){
      // Generate contracts for today if needed
      let currentContracts=world.contracts||[];
      if(world.contractsDay!==gs.day||currentContracts.length===0){
        currentContracts=generateDailyContracts(gs.day,weather);
        const cws={...world,contracts:currentContracts,contractsDay:gs.day};
        setWorld(cws);saveWorld(cws);
      }
      const myCompleted=gs.contractsCompleted||[];
      push("",
        "📋 DAILY CONTRACT BOARD — Day "+gs.day,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Three contracts. One day. Complete them for cash, XP, and rep.",
        "",
        ...currentContracts.map((c,i)=>{
          const done=myCompleted.includes(c.id);
          const diff=c.diff==="hard"?"🔴":c.diff==="medium"?"🟡":"🟢";
          const reward="$"+(c.reward.cash||0)+(c.reward.xp?" +"+c.reward.xp+"XP":"")+(c.reward.rep?" +"+c.reward.rep+"rep":"")+(c.reward.heat?" heat"+c.reward.heat:"")+(c.reward.mental?" +mental":"");
          return (done?"✓":"○")+" "+diff+" "+c.title+"\n   "+c.desc+"\n   Reward: "+reward;
        }),
        "",
        "Progress tracked automatically. Complete tasks today.",
        "Type CONTRACTS to check progress.");
      return;
    }
    // CONTRACT PROGRESS — check what's done
    if(C==="CONTRACT PROGRESS"||C==="MY CONTRACTS"){
      const myC=gs.contractsCompleted||[];
      const myP=gs.contractProgress||{};
      const today=world.contracts||[];
      push("","📋 YOUR CONTRACT PROGRESS","",
        ...today.map(c=>{
          const done=myC.includes(c.id);
          const prog=myP[c.id]||{};
          let status="";
          if(done){status="✓ COMPLETE";}
          else if(c.task.type==="sell"||c.task.type==="fight"||c.task.type==="talk"||c.task.type==="panhandle"){
            const curr=prog.count||0;const needed=c.task.qty||1;
            status=`${curr}/${needed} done`;
          } else {status="In progress";}
          return `${done?"✓":"○"} ${c.title}: ${status}`;
        }));
      return;
    }
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
      const _bntMsgs=[
        gs.name+" put $"+bAmt+" on "+bTarget+"'s head. Bounty board just got interesting.",
        "☠ BOUNTY: $"+bAmt+" on "+bTarget+". Posted by "+gs.name+". Collect it.",
        bTarget+" has a price on their head. $"+bAmt+". "+gs.name+" is serious about it.",
      ];
      const bws2=broadcastActivity(bws,_bntMsgs[rnd(0,_bntMsgs.length-1)],"☠");
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
        trackContract('talk');
      updGs(g=>({...g,lifetime:{...g.lifetime,talkCount:(g.lifetime?.talkCount||0)+1}}));
      push(``,`${npc.icon} ${npc.name}:`,dialogueLine,``);
      }
      setNpcs(prev=>prev.map(n=>n.id===npc.id?{...n,rep:Math.min(n.rep+1,10)}:n));
      // Story flags — talking to named story NPCs unlocks chapter conditions
      const storyNpcFlags={grayson:"found_grayson",deja:"found_deja",mira:"found_mira",zero:"found_zero",
        ivan:"found_ivan",cassandra:"found_cassandra",eleanor:"found_eleanor",witness:"found_witness",carnahan:"flipped_carnahan"};
      const npcNameLower=npc.name.toLowerCase();
      const storyFlag=Object.entries(storyNpcFlags).find(([k])=>npcNameLower.includes(k))?.[1];
      updGs(g=>{
        const newProg={...g.questProgress};
        Object.keys(g.activeQuests||{}).forEach(qid=>{
          const visited=newProg[qid]?.npcsVisited||[];
          if(!visited.includes(npc.id))newProg[qid]={...(newProg[qid]||{}),npcsVisited:[...visited,npc.id]};
        });
        const ng2=applyXP({...g,survival:{...g.survival,mental:clamp((g.survival.mental||70)+8,0,100)},questProgress:newProg},5,"talk");
        const boroRepNow=(ng2.rep||{})[boro]||0;
        const withConvinced=boroRepNow>=5?{...ng2,storyConvinced:(ng2.storyConvinced||0)+1}:ng2;
        // undocumented chapter 4: helping community members
        const withHelped=withConvinced.isUndoc&&boroRepNow>=3?{...withConvinced,storyHelped:(withConvinced.storyHelped||0)+1}:withConvinced;
        // drifter chapter 4: talking to homeless NPCs
        const isHomelessNpc=['ray','dee','carlos'].includes(npc.id);
        const withHelpedDrifters=withHelped.isDrifter&&isHomelessNpc?{...withHelped,storyHelpedDrifters:(withHelped.storyHelpedDrifters||0)+1}:withHelped;
        if(storyFlag)return{...withHelpedDrifters,storyFlags:[...new Set([...(withHelpedDrifters.storyFlags||[]),storyFlag])]};
        return withHelpedDrifters;
      });
      push(`Mental +8. Rep with ${npc.name} up.`);return;}

    // DECLARE WAR [crew]
    // OFFER [player] [product] [qty] [price] — trade offer
    const offerM=C.match(/^OFFER ([A-Za-z0-9_]+) (\w+) (\d+) (\d+)$/);
    if(offerM){
      const [,tName,prod,qtyS,priceS]=offerM;
      const qty=parseInt(qtyS);const price=parseInt(priceS);
      if(tName.toLowerCase()===gs.name.toLowerCase()){push("Can't trade with yourself.");return;}
      if(!PRODUCTS[prod.toLowerCase()]&&!RECIPES[prod.toLowerCase()]){push("Unknown product: "+prod+". Try: weed, pills, powder.");return;}
      const pKey=prod.toLowerCase();
      const held=(gs.product[pKey]||0)+(gs.cooked?.[pKey]||0);
      if(held<qty){push("You only have "+held+" "+pKey+".");return;}
      if(!world.players?.[tName]){push(tName+" is not in this world right now.");return;}
      const offer={id:Math.random().toString(36).slice(2),from:gs.name,to:tName,product:pKey,qty,price,boro,time:Date.now(),expires:Date.now()+300000}; // 5 min expiry
      const offerWs={...world,tradeOffers:{...(world.tradeOffers||{}),[offer.id]:offer}};
      const offerWs2=notifyPlayers(offerWs,gs.name,`💱 ${gs.name} is offering ${qty}x ${pKey} for $${price}. Type ACCEPT ${offer.id} to take it.`);
      setWorld(offerWs2);saveWorld(offerWs2);
      push("","💱 TRADE OFFER SENT",""+qty+"x "+pKey+" → "+tName+" for $"+price,`Offer ID: ${offer.id}`,"Expires in 5 minutes. They need to type ACCEPT "+offer.id,"");
      return;
    }
    // ACCEPT [offer id] — accept a trade offer
    const acceptOfferM=C.match(/^ACCEPT ([A-Za-z0-9]+)$/);
    if(acceptOfferM&&!["RAY","SMOKE","CARLOS","DEE","MARIA"].includes(acceptOfferM[1].toUpperCase())){
      const offerId=acceptOfferM[1];
      const offer=(world.tradeOffers||{})[offerId];
      if(!offer){push("No trade offer found with that ID. Check TRADES.");return;}
      if(offer.to!==gs.name){push("That offer is not for you.");return;}
      if(Date.now()>offer.expires){push("That offer expired.");const ew={...world,tradeOffers:{...(world.tradeOffers||{})}};delete ew.tradeOffers[offerId];setWorld(ew);saveWorld(ew);return;}
      if(gs.cash<offer.price){push("You need $"+offer.price+" to accept. Have $"+gs.cash+".");return;}
      const seller=world.players?.[offer.from];
      // Execute trade — buyer pays, gets product
      updGs(g=>({...g,cash:g.cash-offer.price,
        storyTradesDone:(g.storyTradesDone||0)+1,
        product:{...g.product,[offer.product]:(g.product[offer.product]||0)+offer.qty},
      }));
      // Notify seller and remove offer
      const newOffers={...(world.tradeOffers||{})};delete newOffers[offerId];
      const tradeWs={...world,tradeOffers:newOffers};
      const tradeWs2=notifyPlayers(tradeWs,gs.name,`💱 ${gs.name} accepted your offer. $${offer.price} incoming. Trade complete.`);
      const tradeWs3=broadcastActivity(tradeWs2,`💱 ${offer.from} and ${gs.name} just traded ${offer.qty}x ${offer.product} for $${offer.price}.`,"💱");
      setWorld(tradeWs3);saveWorld(tradeWs3);
      // Fixer gets 10% if they brokered it (were in same boro as either party)
      const fixers=Object.entries(world.players||{}).filter(([n,d])=>{
        const pGs=world.players[n];return pGs?.archId==="fixer"&&(pGs.borough===offer.boro||pGs.borough===boro);
      });
      push("","💱 TRADE COMPLETE","Got "+offer.qty+"x "+offer.product+" from "+offer.from+".","Paid $"+offer.price+".",
        fixers.length>0?"The Fixer takes 10% for brokering. That's the deal.":"","");
      return;
    }
    // DECLINE [offer id]
    const declineM=C.match(/^DECLINE ([A-Za-z0-9]+)$/);
    if(declineM){
      const offer=(world.tradeOffers||{})[declineM[1]];
      if(!offer){push("No offer found.");return;}
      const nO={...(world.tradeOffers||{})};delete nO[declineM[1]];
      const dWs={...world,tradeOffers:nO};
      const dWs2=notifyPlayers(dWs,gs.name,`💱 ${gs.name} declined your trade offer.`);
      setWorld(dWs2);saveWorld(dWs2);
      push("Trade declined.");return;
    }
    // TRADES — show incoming trade offers
    if(C==="TRADES"||C==="OFFERS"){
      const myOffers=Object.values(world.tradeOffers||{}).filter(o=>o.to===gs.name&&Date.now()<o.expires);
      const myOut=Object.values(world.tradeOffers||{}).filter(o=>o.from===gs.name&&Date.now()<o.expires);
      push("","💱 TRADE OFFERS","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        myOffers.length?"INCOMING:":"No incoming offers.",
        ...myOffers.map(o=>`  ${o.from}: ${o.qty}x ${o.product} for $${o.price} · ACCEPT ${o.id} or DECLINE ${o.id}`),
        myOut.length?"OUTGOING:":"",

        ...myOut.map(o=>`  → ${o.to}: ${o.qty}x ${o.product} for $${o.price}`),
        "","OFFER [player] [product] [qty] [price] to make a trade.");
      return;
    }
    const warM=C.match(/^DECLARE WAR (.+)$/);
    if(warM){
      if(!gs.crew){push("Not in a crew.");return;}
      if(gs.crewRole!=="leader"&&gs.crewRole!=="captain"){push("Only crew leaders can declare war.");return;}
      const wTarget=warM[1].trim();
      const myCrewD=world.crews?.[gs.crew]||{};
      if((myCrewD.wars||[]).includes(wTarget)){push("Already at war with "+wTarget+".");return;}
      const upCrew={...myCrewD,wars:[...(myCrewD.wars||[]),wTarget]};
      const wws={...world,crews:{...(world.crews||{}),[gs.crew]:upCrew}};
      const _warMsgs=[
        gs.crew+" DECLARED WAR on "+wTarget+". Every corner is contested until it's done.",
        "⚔ "+gs.crew+" vs "+wTarget+". War is on. Choose your side.",
        "The "+gs.crew+" just called it. War with "+wTarget+". ${getBoro(boro)?.name} is about to get hot.",
      ];
      const wws2=broadcastActivity(wws,_warMsgs[rnd(0,_warMsgs.length-1)],"⚔");
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
    if(C==="RIVALS"||C==="MY RIVALS"){
      const myRivals=Object.entries(world.rivals||{})
        .filter(([k,v])=>k.startsWith(gs.name+":"))
        .map(([k,v])=>({name:k.split(":")[1],attacks:v}));
      const theirRivals=Object.entries(world.rivals||{})
        .filter(([k,v])=>k.endsWith(":"+gs.name))
        .map(([k,v])=>({name:k.split(":")[0],attacks:v}));
      push("","⚔ RIVALS","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        myRivals.length?"People you've beefed with:":"No rivals yet.",
        ...myRivals.map(r=>`  ${r.name} — ${r.attacks} attack${r.attacks>1?"s":""} · ${r.attacks>=2?"RIVAL — 2x bonus if you beat them":"1 more attack to declare rivalry"}`),
        theirRivals.length?"People gunning for you:":"",
        ...theirRivals.map(r=>`  ${r.name} has attacked you ${r.attacks} time${r.attacks>1?"s":""}`),
        "","Beat your rivals for 2x XP and cash.");
      return;
    }
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
      // Update supply drought counters using day-keyed supply
      const newSupply={...world.supply};
      BOROUGHS.forEach(b2x=>Object.keys(PRODUCTS).forEach(pk2=>{
        const dayKey=`${b2x.id}_${pk2}_d${gs.day}`;
        const droughtKey=`${b2x.id}_${pk2}_drought`;
        const soldToday=(newSupply[dayKey]||0)>0;
        if(!soldToday){newSupply[droughtKey]=(newSupply[droughtKey]||0)+1;}
        else{newSupply[droughtKey]=0;}
      }));
      // Clean old day keys to prevent DB bloat
      Object.keys(newSupply).filter(k=>{const m=k.match(/_d(\d+)$/);return m&&parseInt(m[1])<gs.day-2;}).forEach(k=>delete newSupply[k]);
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
      // ── CORNER INCOME & RIVAL PRESSURE ────────────────────────────────────────
      // Income tiers: HOT=100% (visited), WARM=60% (army), COLD=10%, CONTESTED/LOST=0%
      let income=0;const coldCorners=[];const contestedCorners=[];
      const newWorldCorners={...world.corners};
      const newContested={...(world.cornerContested||{})};
      const newContestedBy={...(world.cornerContestedBy||{})};
      let totalHeatGain=0; // accumulate heat outside forEach

      gs.cornersOwned.forEach(bId=>{
        const lvl=world.cornerLevels?.[bId]||0;
        const tier=getCornerTier(bId,gs,world);
        const dailyRate=getCornerIncome(bId,lvl,gs,world,tier);
        const passiveDrip=Math.floor(dailyRate*0.25); // 25% lands on sleep

        if(tier===CORNER_TIERS.HOT||tier===CORNER_TIERS.WARM){
          income+=passiveDrip;
          totalHeatGain+=(CORNER_HEAT_DRAIN[bId]||0.1); // accumulate, don't call updGs
        } else if(tier===CORNER_TIERS.COLD){
          income+=Math.floor(passiveDrip*0.1); // tiny survival trickle
          coldCorners.push(getBoro(bId)?.short||bId);
          // Roll rival pressure on cold corners
          const lastVisit=world.cornerLastVisit?.[gs.name+":"+bId]||0;
          const daysSince=gs.day-(lastVisit||0);
          const rivals=NPC_RIVAL_CREWS.filter(r=>r.boroughs.includes(bId));
          if(rivals.length>0&&daysSince>=CORNER_PRESENCE_DAYS+1){
            const rival=rivals[Math.floor(Math.random()*rivals.length)];
            const pressure=rival.aggression*(daysSince-CORNER_PRESENCE_DAYS)*0.3;
            if(Math.random()<pressure){
              newContested[bId]=gs.day;
              newContestedBy[bId]=rival.name;
              contestedCorners.push({boro:bId,rival});
            }
          }
        } else if(tier===CORNER_TIERS.CONTESTED){
          const rivalName=(world.cornerContestedBy||{})[bId];
          const rival=NPC_RIVAL_CREWS.find(r=>r.name===rivalName);
          const armyPower=getArmyPower(gs.army||[]);
          const armyDeployed=(gs.armyDeployedBoro||{})[bId];
          if(armyDeployed&&armyPower>=(rival?.power||3)){
            // Army holds it — clears contested
            delete newContested[bId];
            delete newContestedBy[bId];
            income+=passiveDrip;
            setTimeout(()=>push(`💪 Your army held the ${getBoro(bId)?.short} corner against ${rival?.name||"rivals"}.`),200);
          } else {
            // Day has passed — corner lost
            const daysSinceContest=gs.day-(world.cornerContested?.[bId]||gs.day);
            if(daysSinceContest>=1){
              newWorldCorners[bId]=rival?.id||"npc_rival";
              delete newContested[bId];
              delete newContestedBy[bId];
              contestedCorners.push({boro:bId,rival,lost:true});
            }
          }
        }
      });

      // Single world update for all corner changes
      const worldChanged=
        JSON.stringify(newContested)!==JSON.stringify(world.cornerContested||{})||
        JSON.stringify(newContestedBy)!==JSON.stringify(world.cornerContestedBy||{})||
        contestedCorners.some(c=>c.lost);
      if(worldChanged){
        const newWs={...world,corners:newWorldCorners,cornerContested:newContested,cornerContestedBy:newContestedBy};
        setWorld(newWs);saveWorld(newWs);
      }
      // Single updGs for all corner-related gs changes (heat + lost corners)
      const lostBoros=contestedCorners.filter(c=>c.lost).map(c=>c.boro);
      if(totalHeatGain>0||lostBoros.length>0){
        updGs(g=>({...g,
          heat:clamp(g.heat+totalHeatGain,0,10),
          cornersOwned:lostBoros.length>0?g.cornersOwned.filter(b=>!lostBoros.includes(b)):g.cornersOwned,
        }));
      }

      // Report contested / lost corners
      contestedCorners.forEach(({boro:bId,rival,lost})=>{
        const bn=getBoro(bId)?.name||bId;
        if(lost){
          setTimeout(()=>push(``,`☠ ${bn} CORNER LOST`,`${rival?.name||"Rivals"} moved in while you were gone.`,`RECLAIM to take it back. Or let it go.`,``),300);
        } else {
          setTimeout(()=>push(``,`⚔ ${bn} CORNER CONTESTED`,`${rival?.name||"Rivals"} are moving in.`,`VISIT NOW or DEPLOY army. You have 1 day before it's gone.`,``),300);
        }
      });
      const thrallIncome=(gs.thralls||[]).length*30;
      const networkIncome=gs.isFixer&&hasSkill(gs,"network_effect")?Object.keys(world.players||{}).length*5:0;
      // reset rat daily infos
      if(gs.isRat)updGs(g=>({...g,informsToday:0}));
      // mark as away during sleep
      const _cut24=Date.now()-(24*60*60*1000);
      const _cPlayers=Object.fromEntries(Object.entries(world.players||{}).filter(([n,d])=>n===gs.name||(d.lastSeen&&d.lastSeen>_cut24)));
      const sleepWs={...world,players:{..._cPlayers,[gs.name]:{...(_cPlayers[gs.name]||{}),lastSeen:Date.now()-200000}}};
      setWorld(sleepWs);saveWorld(sleepWs);
      const nightIncome=gs.isVampire&&hasSkill(gs,"ancient_blood")?rnd(30,80):0;
      const crewBonus=gs.crew&&world.crews?.[gs.crew]?rnd(5,15):0;
      // Clean old day-keyed supply entries
      Object.keys(newSupply).filter(k=>{const m=k.match(/_d(\d+)$/);return m&&parseInt(m[1])<gs.day-2;}).forEach(k=>delete newSupply[k]);
      const safePassive=Object.entries(world.safehouses||{}).filter(([,s])=>s.owner===gs.name||(gs.crew&&s.crewOwner===gs.crew)).length*rnd(5,10);
      // Check survive-type contracts on sleep
      trackContract('sleep_check',{heat:gs.heat,warmth:gs.survival.warmth,hunger:gs.survival.hunger});
      // Army upkeep — pay daily or units desert
      const _army=gs.army||[];
      const _upkeep=getArmyUpkeep(_army);
      const _heatAdd=getArmyHeatMult(_army);
      if(_army.length>0){
        if(gs.cash>=_upkeep){
          updGs(g=>({...g,cash:g.cash-_upkeep,heat:clamp(g.heat+_heatAdd,0,10),lifetime:{...g.lifetime,daysAlive:(g.lifetime?.daysAlive||0)+1}}));
          if(_upkeep>0)setTimeout(()=>push("💪 Army paid: -$"+_upkeep+". "+(_heatAdd>0?"Heat +"+_heatAdd.toFixed(1)+" from having muscle on the street.":"")),200);
        } else {
          // Can't pay — units desert
          const canAfford=_army.filter((u,i)=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return (unit?.upkeep||0)<=gs.cash;});
          updGs(g=>({...g,army:canAfford,heat:clamp(g.heat+_heatAdd*0.5,0,10),lifetime:{...g.lifetime,daysAlive:(g.lifetime?.daysAlive||0)+1}}));
          setTimeout(()=>push("","⚠ COULDN'T MAKE PAYROLL",""+(_army.length-canAfford.length)+" unit"+((_army.length-canAfford.length)>1?"s":"")+" deserted. Pay your people.",""),200);
        }
      } else {
        updGs(g=>({...g,lifetime:{...g.lifetime,daysAlive:(g.lifetime?.daysAlive||0)+1}}));
      }
      setTimeout(()=>checkNotoriety(gsRef.current,updGs,push,worldRef,saveWorld),500);
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
        return{...g,day:nextDay,addiction:newAddiction,
          cash:g.cash-habitCost+income+crewBonus+safePassive+commBonus,
          survival:{hunger:clamp(g.survival.hunger-20,0,100),warmth:clamp(g.survival.warmth-10,0,100),health:clamp(habHealth,0,100),energy:95},
          heat:clamp(g.heat-2,0,10),habitPaid:g.cash>=habitCost,
          hustleCount:0,hustleBoroLast:"",hustleBoros:{},
          dayJobDone:false,hasMetrocard:false,panhandleCount:0,dailySells:{},
          contractsCompleted:[],contractProgress:{},
          // storyBoroDays: increment if slept in same boro as yesterday
          storyBoroDays:g.sleepBoro===boro?(g.storyBoroDays||0)+1:0,
          sleepBoro:boro,
          // storyHeldCorner: increment if owned corners in this boro and not cold
          storyHeldCorner:(g.cornersOwned||[]).includes(boro)&&!coldCorners.includes(getBoro(boro)?.short||boro)?(g.storyHeldCorner||0)+1:g.storyHeldCorner||0,
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
      const _sleepMsgs=[
        `${gs.name} called it a night. Day ${gs.day} in the books.`,
        `${gs.name} is off the streets. Day ${gs.day}. Cash: $${gs.cash}. Still breathing.`,
        `Day ${gs.day} done for ${gs.name}. Level ${gs.level}. See you tomorrow.`,
        `${gs.name} found somewhere to sleep. Day ${gs.day}. $${gs.cash} to their name.`,
      ];
      const sleepActWs=broadcastActivity(world,_sleepMsgs[rnd(0,_sleepMsgs.length-1)],"🌙");
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
        `${regularIncome>0?"Regulars: +$"+regularIncome+". ":""}${income>0?"Corners (passive drip): +$"+income+(coldCorners.length?" ("+coldCorners.join(",")+": COLD)":"")+". 💡 COLLECT for accrued. ":""}${contestedCorners.length?" ⚠ "+contestedCorners.length+" corner(s) contested!":""}`+
        (crewBonus>0?"Crew added $"+crewBonus+". ":"")+
        (safePassive>0?"Safe houses: +$"+safePassive+". ":"")+
        (commBonus>0?"Community network: +$"+commBonus+". ":"")+
        (thrallIncome>0?"Thralls: +$"+thrallIncome+". ":"")+
        (nightIncome>0?"Night economy: +$"+nightIncome+". ":"")+
        (networkIncome>0?"Network cut: +$"+networkIncome:""),
        habitMsg||"",
        `${nextWeather.icon} ${nextWeather.name} today — ${nextWeather.desc}`,
        ``,
      );
      // Weekly winner check
      const _wk2=getWeekNumber();const _prev2=_wk2-1;const _lbd=world.leaderboard||{};
      if(_lbd[_prev2]&&world.leaderboardWeek!==_wk2){
        LEADERBOARD_CATEGORIES.forEach(cat=>{
          const _ents=Object.values(_lbd[_prev2]||{}).filter(e=>e&&typeof e==="object"&&e.name&&e[cat.id]!=null);
          if(_ents.length>0){const _win=_ents.sort((a,b)=>(b[cat.id]||0)-(a[cat.id]||0))[0];
            if(_win&&_win.name===gs.name){const rwd=WEEKLY_REWARDS[cat.id];if(rwd){
              updGs(g=>({...g,cash:g.cash+rwd.cash,inventory:[...(g.inventory||[]),rwd.item],title:g.title||rwd.title}));
              setTimeout(()=>push("","🏆 WEEKLY WINNER: "+cat.label,"You topped the leaderboard!","Reward: "+rwd.title+" + $"+rwd.cash+" + "+rwd.item,""),600);
              const bWs=broadcastActivity(world,gs.name+" won the weekly "+cat.label+"! "+cat.icon+" "+rwd.title,"🏆");
              setWorld(p=>({...p,...bWs,leaderboardWeek:_wk2}));saveWorld({...world,...bWs,leaderboardWeek:_wk2});
            }}
          }
        });
      }
      if(coldCorners.length>0){
        push("","⚠ COLD CORNERS: "+coldCorners.join(", "),"You haven't visited in "+CORNER_PRESENCE_DAYS+"+ days. No income until you show up.","");
      }
      return;
    }

    // HIRE [unit] — recruit army unit
    if(C==="HIRE"||C==="ARMY"||C==="MY ARMY"){
      const army=gs.army||[];
      const slots=getArmySlots(army);
      const power=getArmyPower(army);
      const upkeep=getArmyUpkeep(army);
      const combatB=getArmyCombatBonus(army);
      const defenseB=getArmyDefenseBonus(army);
      const heatDaily=getArmyHeatMult(army);
      push("","💪 YOUR STREET ARMY","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        army.length?"Roster ("+army.length+" units, "+slots+"/"+MAX_ARMY_SIZE+" slots):":"No army yet.",
        ...army.map(u=>{const unit=ARMY_UNITS.find(x=>x.id===u.id)||{};return "  "+unit.icon+" "+unit.name+" — $"+unit.upkeep+"/day upkeep · Power "+unit.power;}),
        army.length?"Stats: Combat +"+combatB+" · Defense +"+defenseB+" · Daily upkeep $"+upkeep+" · Heat +"+heatDaily.toFixed(1)+"/day":"",
        "","AVAILABLE TO HIRE:",
        ...ARMY_UNITS.filter(u=>getArmySlots(army)+u.slots<=MAX_ARMY_SIZE).map(u=>"  HIRE "+u.name.toUpperCase().replace(/ /g,"_")+" — $"+u.cost+" (upkeep $"+u.upkeep+"/day) · "+u.desc),
        slots>=MAX_ARMY_SIZE?"Army at max capacity ("+MAX_ARMY_SIZE+" slots).":"Slots used: "+slots+"/"+MAX_ARMY_SIZE,
        "","FIRE [unit] to dismiss. DEPLOY [borough] to station army there. ARMY STATUS for battlefield info.");
      return;
    }
    const hireMx=C.match(/^HIRE (.+)$/);
    if(hireMx){
      const unitName=hireMx[1].toLowerCase().replace(/_/g," ");
      const unit=ARMY_UNITS.find(u=>u.name.toLowerCase()===unitName||u.id===unitName.replace(/ /g,"_"));
      if(!unit){push("Unknown unit. HIRE to see available units: lookout, runner, enforcer, lieutenant, street fixer.");return;}
      const army=gs.army||[];
      const slots=getArmySlots(army);
      if(slots+unit.slots>MAX_ARMY_SIZE){push("Not enough slots. "+unit.name+" needs "+unit.slots+" slot"+(unit.slots>1?"s":"")+". Current: "+slots+"/"+MAX_ARMY_SIZE+".");return;}
      if(gs.cash<unit.cost){push("Need $"+unit.cost+" to hire "+unit.name+". Have $"+gs.cash+".");return;}
      const newMember={id:unit.id,name:unit.name,hiredDay:gs.day};
      updGs(g=>({...g,cash:g.cash-unit.cost,army:[...(g.army||[]),newMember]}));
      // Big army = cops notice
      const newArmy=[...(gs.army||[]),newMember];
      const newPower=getArmyPower(newArmy);
      if(newPower>=8){
        push("",""+unit.icon+" "+unit.name+" hired. -$"+unit.cost+".",
          "⚠ Your operation is getting large. Police will take notice. Expect increased heat.",
          "Army power: "+newPower+". Daily upkeep: $"+getArmyUpkeep(newArmy)+". Daily heat: +"+getArmyHeatMult(newArmy).toFixed(1),"");
      } else {
        push("",""+unit.icon+" "+unit.name+" hired. -$"+unit.cost+".",
          "Army power: "+newPower+". Daily upkeep: $"+getArmyUpkeep(newArmy)+". Heat drain: +"+getArmyHeatMult(newArmy).toFixed(1)+"/day","");
      }
      return;
    }
    // FIRE [unit] — dismiss an army member
    const fireMx=C.match(/^FIRE (.+)$/);
    if(fireMx&&!["FIGHT","FEED"].includes(fireMx[1].toUpperCase())){
      const unitName=fireMx[1].toLowerCase().replace(/_/g," ");
      const army=gs.army||[];
      const idx=army.findIndex(u=>{const unit=ARMY_UNITS.find(x=>x.id===u.id);return unit&&unit.name.toLowerCase()===unitName;});
      if(idx<0){push("No "+unitName+" in your army.");return;}
      const fired=army[idx];const firedUnit=ARMY_UNITS.find(x=>x.id===fired.id)||{};
      const newArmy=[...army.slice(0,idx),...army.slice(idx+1)];
      updGs(g=>({...g,army:newArmy}));
      push(firedUnit.icon+" "+firedUnit.name+" dismissed. They walk. No hard feelings — probably.","Army power now: "+getArmyPower(newArmy)+". Upkeep: $"+getArmyUpkeep(newArmy)+"/day.");
      return;
    }
    // DEPLOY [borough] — station army in a borough for corner protection
    const deployMx=C.match(/^DEPLOY (.+)$/);
    if(deployMx){
      const army=gs.army||[];
      if(army.length===0){push("No army to deploy. HIRE units first.");return;}
      const target=BOROUGHS.find(bx=>bx.id===deployMx[1].toLowerCase()||bx.name.toLowerCase().includes(deployMx[1].toLowerCase())||bx.short.toLowerCase()===deployMx[1].toLowerCase());
      if(!target){push("Unknown borough. Try: bronx, brooklyn, manhattan, queens, staten.");return;}
      // armyDeployedBoro tracks which boro each unit type is in
      const hasLt=army.some(u=>u.id==="lieutenant");
      const hasEnforcer=army.some(u=>u.id==="enforcer");
      if(!hasLt&&!hasEnforcer){push("Need a Lieutenant or Enforcer to hold a corner. Lookouts and Runners can't defend alone.");return;}
      const curDeployed=gs.armyDeployedBoro||{};
      const newDeployed={...curDeployed,[target.id]:true};
      // unset from old boro if lt was there
      Object.keys(curDeployed).filter(b=>b!==target.id).forEach(b=>{delete newDeployed[b];});
      updGs(g=>({...g,armyDeployedBoro:newDeployed,armyDeployed:target.id}));
      const tier=getCornerTier(target.id,{...gs,armyDeployedBoro:newDeployed},world);
      const _dPower=getArmyPower(army);
      if(_dPower>=6){
        const _dWs=broadcastActivity(world,gs.name+" locked down "+target.name+" with "+_dPower+"-power army.","💪");
        setWorld(_dWs);saveWorld(_dWs);
      }
      push("","💪 ARMY DEPLOYED → "+target.name,
        "Units stationed: "+army.map(u=>u.name).join(", "),
        gs.cornersOwned?.includes(target.id)?`Corner tier: ${tier.icon} ${tier.name} — ${tier.desc}`:"No corner here yet — CLAIM one.",
        "Defense bonus: +"+getArmyDefenseBonus(army)+" vs rival attacks.",
        "Army earns income at 60% rate while deployed without you.",
        "","DEPLOY [other boro] to redirect. Army can only hold one borough.");
      return;
    }
    // CORNERS — corner map with tier display
    if(C==="CORNERS"||C==="CORNER MAP"){
      push("","🚩 CORNER MAP","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ...BOROUGHS.map(bx=>{
          const ow=world.corners?.[bx.id];const lv=world.cornerLevels?.[bx.id]||0;
          const isMe=ow===gs.name;
          if(!isMe&&!ow)return `  ${bx.short}: UNCLAIMED`;
          if(!isMe&&ow)return `  ${bx.short}: ${ow} L${lv}`;
          const tier=getCornerTier(bx.id,gs,world);
          const dailyRate=getCornerIncome(bx.id,lv,gs,world,tier);
          const lastVisit=world.cornerLastVisit?.[gs.name+":"+bx.id]||0;
          const daysSince=gs.day-(lastVisit||0);
          const contestedDay=(world.cornerContested||{})[bx.id];
          return `  ${bx.short}: YOU L${lv} ${tier.icon}${tier.name} · $${dailyRate}/day · visited ${daysSince}d ago`+
            (contestedDay?` ⚠ CONTESTED by ${(world.cornerContestedBy||{})[bx.id]||"rivals"}!`:"");
        }),
        "","Legend: 🔥HOT(100%) 🟡WARM(60% army) ❄️COLD(10%) ⚔CONTESTED → act now",
        "COLLECT — pocket accrued income · DEPLOY [boro] — station army · LOOK to refresh corner");
      return;
    }
    // RECOVERY — addiction recovery arc with Carmen
    if(C==="RECOVERY"||C==="CARMEN"){
      if((gs.addiction||0)<40){push("You don't need this yet. Keep it that way.");return;}
      const carmenRep=gs.carmenRep||0;
      const dialogue=CARMEN_DIALOGUE[Math.min(carmenRep,CARMEN_DIALOGUE.length-1)];
      push("","🌿 CARMEN'S DROP-IN CENTER","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Carmen (recovery counselor):",`"${dialogue.line}"`,
        "","You can come back here every day. Each visit helps.",
        carmenRep>=3?"Your addiction is dropping faster now.":"Keep showing up. It takes time.",
        carmenRep>=5?"[Recovery Track complete — addiction recovers 2x faster permanently]":"",
        "","Type RECOVERY again tomorrow to check in.");
      // Reduce addiction on visit
      const reduction=carmenRep>=5?8:carmenRep>=3?5:3;
      updGs(g=>({...g,
        addiction:Math.max(0,( g.addiction||0)-reduction),
        carmenRep:(g.carmenRep||0)+1,
        lastRecovery:g.day,
      }));
      if((gs.addiction||0)-reduction<=0){
        push("","🌿 CLEAN","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          "Addiction: 0. You did it.",
          "Carmen nods. Doesn't say much. You both know what this took.","");
        updGs(g=>({...g,title:g.title||"THE RECOVERED",notorietyTitle:g.notorietyTitle||"survivor"}));
      }
      return;
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
        updGs(g=>applyXP({...g,connectCount:(g.connectCount||0)+1,survival:{...g.survival,hunger:clamp(g.survival.hunger+40,0,100)}},5,"talk"));
      } else if(result.includes("Heat")){
        updGs(g=>applyXP({...g,connectCount:(g.connectCount||0)+1,heat:clamp(g.heat-1,0,10)},5,"scout"));
      } else if(result.includes("$15")){
        updGs(g=>applyXP({...g,connectCount:(g.connectCount||0)+1,cash:g.cash+15},5,"hustle"));
      } else {
        updGs(g=>applyXP({...g,connectCount:(g.connectCount||0)+1},10,"scout"));
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
      const current=Object.entries(PRODUCTS).map(([key,p])=>({key,buy:Math.round(mktPrice(boro,key,gs.day,weather,world.supply)*p.bm),sell:mktPrice(boro,key,gs.day,weather,world.supply)}));
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
      const panEventMult=weEffect.panhandleMult||1;
      const maxEarned=Math.max(1,Math.round((base+dogBonus+charmBonus+weatherBonus-repeatPenalty)*panEventMult));
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
        trackContract('panhandle',{success:true});
        updGs(g=>({...g,lifetime:{...g.lifetime,panhandles:(g.lifetime?.panhandles||0)+1}}));
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
        // drifter story: dog-friendly shelter count (isDrifter only does this if they found a place that allows dogs)
        storyDogShelters:g.isDrifter?(g.storyDogShelters||0)+1:g.storyDogShelters||0,
      }));
      trackContract("shelter");
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

    // SCAVENGE — borough-specific deep search with cooldown
    if(C==="SCAVENGE"){
      const now2=Date.now();
      const lastScav=gs.lastScavenge||0;
      const cooldown=3600000;
      if(now2-lastScav<cooldown){
        const minLeft=Math.ceil((cooldown-(now2-lastScav))/60000);
        push("You already searched this area. Wait "+minLeft+" more minutes.");return;
      }
      if(gs.survival.energy<25){push("Too exhausted to search properly. REST first.");return;}
      const boroLoot={
        manhattan:[
          {w:20,fn:()=>{const a=rnd(30,80);updGs(g=>({...g,cash:g.cash+a}));return "Midtown trash has money in it. $"+a+" in a dropped bag."}},
          {w:15,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Police Scanner"]}));return "Back of a cab. Police scanner left on the seat."}},
          {w:15,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Brass Knuckles"]}));return "Alley off 9th Ave. Someone's insurance policy. You take it."}},
          {w:25,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Street Bandage"]}));return "Pharmacy dumpster. Sealed kit. Still good."}},
          {w:25,fn:()=>{const a=rnd(15,40);updGs(g=>({...g,cash:g.cash+a}));return "Office coat pocket. $"+a+". Conference room souvenir."}},
        ],
        brooklyn:[
          {w:25,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Army Jacket"]}));return "Bed-Stuy donation bin. Army jacket. You take it."}},
          {w:25,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Crowbar"]}));return "Construction site off Atlantic. Crowbar leaning against the fence."}},
          {w:25,fn:()=>{const a=rnd(20,50);updGs(g=>({...g,cash:g.cash+a}));return "Nostrand Ave alley. $"+a+" in a coffee can."}},
          {w:25,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Hot Meal (Container)"]}));return "Community kitchen side door. Hot container. Still warm."}},
        ],
        bronx:[
          {w:33,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Tire Iron"]}));return "Stripped car on Morris Ave. Tire iron left behind."}},
          {w:33,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Army Ration"]}));return "Old VA supply box. Army ration, sealed."}},
          {w:34,fn:()=>{const a=rnd(10,35);updGs(g=>({...g,cash:g.cash+a}));return "$"+a+" in coins outside the station."}},
        ],
        queens:[
          {w:33,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Lucky Coin"]}));return "Flushing market alley. Old coin. Heavy. You keep it."}},
          {w:33,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Hip Flask"]}));return "Jackson Heights stoop. Flask left behind. Still has something in it."}},
          {w:34,fn:()=>{const a=rnd(25,60);updGs(g=>({...g,cash:g.cash+a}));return "Restaurant alley. $"+a+" left in a cash register."}},
        ],
        staten:[
          {w:30,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Spiked Bat"]}));return "Abandoned auto shop. Bat with nails. Yours now."}},
          {w:30,fn:()=>{updGs(g=>({...g,inventory:[...g.inventory,"Old MetroCard"]}));return "Ferry terminal lost and found. MetroCard. Might have rides."}},
          {w:40,fn:()=>{const a=rnd(8,25);updGs(g=>({...g,cash:g.cash+a}));return "$"+a+" in a jar near the greenway. Someone's emergency fund."}},
        ],
      };
      const pool=boroLoot[boro]||boroLoot.brooklyn;
      const totalW=pool.reduce((s,e)=>s+e.w,0);
      let roll=Math.random()*totalW,result="Nothing worth taking here.";
      for(const e of pool){roll-=e.w;if(roll<=0){result=e.fn();break;}}
      // 25% chance to also find a rolled gear item while scavenging
      const luckBonus=(getItemStats(gs.equipment||{}).luck||0);
      if(Math.random()<0.25){
        const scavItem=rollItemFromSlot(["weapon","hands","feet","accessory"][rnd(0,3)],luckBonus);
        updGs(g=>({...g,inventory:[...g.inventory,scavItem]}));
        result+=" Also found: "+itemDropMsg(scavItem)+".";
      }
      updGs(g=>({...g,lastScavenge:now2,survival:{...g.survival,energy:clamp(g.survival.energy-30,0,100)}}));
      push("","🔍 SCAVENGE — "+b.name,"",result,"","Energy -30. Cooldown 1 hour. SEARCH for quick finds anytime.");
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
        updGs(g=>applyXP({...g,cash:g.cash+amt,lastSearch:now,
          storyManhattanSearches:boro==="manhattan"?(g.storyManhattanSearches||0)+1:g.storyManhattanSearches||0,
          // junkie story: decoding hidden messages while searching
          storyDecoded:g.archetype?.id==="junkie"&&Math.random()<0.3?(g.storyDecoded||0)+1:g.storyDecoded||0,
          survival:{...g.survival,mental:clamp((g.survival.mental||70)+mentalBoost,0,100)}},6,"scout"));
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

    // WRITE [player] [message] — send letter to specific player
    // or WRITE [message] — world log entry
    const writePlayerM=raw.match(/^WRITE ([A-Za-z0-9_]+) (.+)$/i);
    if(writePlayerM&&world.players?.[writePlayerM[1]]&&writePlayerM[1]!==gs.name){
      const toName=writePlayerM[1];const letterText=writePlayerM[2];
      const letter={id:Math.random().toString(36).slice(2),from:gs.name,to:toName,text:letterText,day:gs.day,boro,time:Date.now(),read:false};
      const ws={...world,letters:[...(world.letters||[]).slice(-49),letter]};
      const ws2=notifyPlayers(ws,gs.name,`✉ Letter from ${gs.name}: "${letterText.slice(0,60)}${letterText.length>60?"...":""}"`);
      setWorld(ws2);saveWorld(ws2);
      push("","✉ LETTER SENT","To: "+toName,'"'+letterText+'"',"They will get it when they log in.","");return;
    }
    // LETTERS — check your mail
    if(C==="LETTERS"||C==="MAIL"||C==="READ LETTERS"){
      const myLetters=(world.letters||[]).filter(l=>l.to===gs.name||(!l.to));
      const unread=myLetters.filter(l=>l.to===gs.name&&!l.read);
      const worldLog=(world.letters||[]).filter(l=>!l.to).slice(-5);
      if(unread.length>0){
        push("","✉ YOUR MAIL","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          ...unread.map(l=>"From "+l.from+" · Day "+l.day+" · "+(getBoro(l.boro)?.short||"?")+':\n  "'+l.text+'"'),
          "");
        // Mark as read
        const updLetters=(world.letters||[]).map(l=>l.to===gs.name?{...l,read:true}:l);
        const ws={...world,letters:updLetters};setWorld(ws);saveWorld(ws);
      } else {
        push("No unread letters.");
      }
      if(worldLog.length>0){
        push("— LETTERS FROM THE STREET —",...worldLog.map(l=>`${l.from} · Day ${l.day} · ${getBoro(l.boro)?.short||"?"}: "${l.text}"`));
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
      // log to world history only — no broadcast, rare events are personal
      const ws=addWorldHistory(world,"event",gs.name,`${gs.name} faced "${rareEvent.title}" — chose: ${choice.label}`,boro);
      setWorld(ws);saveWorld(ws);setWMsgs(ws.messages||[]);
      setRareEvent(null);return;
    }

    // RETIRE — prestige system
    // DELETE ACCOUNT — permanent character deletion
    if(C==="DELETE ACCOUNT"){
      push("","⚠ DELETE ACCOUNT","This will permanently delete your character.","Type CONFIRM DELETE to proceed. This cannot be undone.","");
      return;
    }
    if(C==="CONFIRM DELETE"){
      push("Deleting character...");
      deleteCharacter(gs.name, pinRef.current||"").then(deleted=>{
        if(deleted){
          const dp={...world.players};delete dp[gs.name];
          const dws={...world,players:dp};setWorld(dws);saveWorld(dws);
          setTimeout(()=>{setGs(null);setPhase("character");},1500);
          push("","Character deleted. Starting fresh.","");
        } else {
          push("Deletion failed. Check your PIN and try again.");
        }
      }).catch(()=>push("Deletion failed. Try again."));
      return;
    }
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
        const itemOrId=gs.equipment?.[slot];
        const item=itemOrId?(typeof itemOrId==="object"&&itemOrId._rolled?itemOrId:getItemById(itemOrId)):null;
        const rar=item?ITEM_RARITY[item.rarity]:null;
        const statStr=item?Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", "):"";
        return "  "+slot.toUpperCase()+": "+(item?(rar?.prefix||"")+item.name+(statStr?" ["+statStr+"]":""):"(empty)");
      }),``,`Stat bonuses: ${Object.entries(eqStats).filter(([,v])=>v).map(([k,v])=>`${k}+${v}`).join(", ")||"none"}`);
      return;
    }

    // EQUIP [item name] — equip an item from inventory
    const equipM=C.match(/^EQUIP (.+)$/);
    if(equipM){
      const iName=raw.slice(6).trim().toLowerCase();
      // Check rolled items in inventory first
      const rolledMatch=gs.inventory.find(i=>typeof i==="object"&&i._rolled&&i.name.toLowerCase()===iName);
      if(rolledMatch){
        const slot=rolledMatch.slot;
        const oldEquipped=gs.equipment?.[slot];
        const newInv=gs.inventory.filter(i=>i!==rolledMatch);
        if(oldEquipped){
          // put old item back in inventory
          const oldItem=typeof oldEquipped==="object"&&oldEquipped._rolled?oldEquipped:getItemById(oldEquipped);
          if(oldItem)newInv.push(oldItem);
        }
        updGs(g=>({...g,equipment:{...g.equipment,[slot]:rolledMatch},inventory:newInv}));
        const statStr=Object.entries(rolledMatch.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
        push(`Equipped: ${ITEM_RARITY[rolledMatch.rarity]?.prefix||""}${rolledMatch.name} (${slot})`,`Stats: ${statStr||"none"}`);
        return;
      }
      // Fall back to static BASE_ITEMS
      const item=BASE_ITEMS.find(i=>i.name.toLowerCase()===iName||i.id===iName.replace(/ /g,"_"));
      if(!item){push(`Don't know that item. Check INVENTORY for exact name.`);return;}
      if(!gs.inventory.includes(item.name)&&!gs.inventory.includes(item.id)){push(`Don't have ${item.name}.`);return;}
      const oldItem=gs.equipment?.[item.slot];
      const newInv=gs.inventory.filter(i=>i!==item.name&&i!==item.id);
      if(oldItem){const old=typeof oldItem==="object"&&oldItem._rolled?oldItem:getItemById(oldItem);if(old)newInv.push(old._rolled?old:old.name);}
      updGs(g=>({...g,equipment:{...g.equipment,[item.slot]:item.id},inventory:newInv}));
      push(`Equipped: ${ITEM_RARITY[item.rarity].prefix}${item.name} (${item.slot})`,`Stats: ${Object.entries(item.stats).map(([k,v])=>`${k}+${v}`).join(", ")}`);
      return;
    }

    // UNEQUIP [slot] — remove equipped item
    const unequipM=C.match(/^UNEQUIP (\w+)$/);
    if(unequipM){
      const slot=unequipM[1].toLowerCase();
      if(!EQUIPMENT_SLOTS.includes(slot)){push(`Slots: ${EQUIPMENT_SLOTS.join(", ")}`);return;}
      const itemOrId=gs.equipment?.[slot];
      if(!itemOrId){push(`Nothing equipped in ${slot}.`);return;}
      const item=typeof itemOrId==="object"&&itemOrId._rolled?itemOrId:getItemById(itemOrId);
      // Put item back in inventory as object (if rolled) or name (if static)
      const invItem=item?._rolled?item:(item?.name||null);
      updGs(g=>({...g,equipment:{...g.equipment,[slot]:null},inventory:invItem?[...g.inventory,invItem]:g.inventory}));
      push(`Unequipped ${item?.name||slot}.`);return;
    }

    // LOOT — show available items to find/buy (black market — rolled items)
    if(C==="LOOT"){
      const luckBonus=(getItemStats(gs.equipment||{}).luck||0);
      // Generate today's market using day+boro as seed for consistency
      const seed=(gs.day*7+boro.length*3)%ITEM_TEMPLATES.length;
      const todayTemplates=[
        ITEM_TEMPLATES[seed%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+5)%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+11)%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+17)%ITEM_TEMPLATES.length],
      ];
      // Store today's market in local variable so BUY ITEM can reference same rolls
      // Roll items deterministically with day seed
      const mkRng=(n)=>{let s=gs.day*1000+n;return()=>{s=s*16807%2147483647;return(s-1)/2147483646;};};
      const marketItems=todayTemplates.map((t,idx)=>{
        const rng=mkRng(idx*99+boro.length);
        // roll deterministically
        const rItem={_rolled:true,id:t.id+"_mkt_"+gs.day+"_"+idx,templateId:t.id,slot:t.slot};
        const rw=t.weights||{common:50,uncommon:30,rare:15,legendary:5};
        let rr=rng()*(Object.values(rw).reduce((a,b)=>a+b,0)+luckBonus*10);
        let rarity="common";
        for(const [r,w] of Object.entries(rw)){rr-=w;if(rr<=0){rarity=r;break;}}
        const stats={};
        for(const [stat,[min,max]] of Object.entries(t.statRanges||{})){
          const sign=min<0||max<0?-1:1;
          const absMax=Math.max(Math.abs(min),Math.abs(max));
          const absMin2=Math.min(Math.abs(min),Math.abs(max));
          const rm={common:0.4,uncommon:0.65,rare:0.85,legendary:1.0}[rarity];
          const v=Math.floor(absMin2+rng()*(absMax-absMin2+1)*rm);
          if(v>0)stats[stat]=sign*v;
        }
        let name=t.name;
        if(rarity==="legendary"){
          const pfx=LEGENDARY_PREFIXES[Math.floor(rng()*LEGENDARY_PREFIXES.length)];
          const sfx=(LEGENDARY_SUFFIXES_BY_SLOT[t.slot]||["of the Streets"])[Math.floor(rng()*(LEGENDARY_SUFFIXES_BY_SLOT[t.slot]||["of the Streets"]).length)];
          name=pfx+" "+t.name+" "+sfx;
        } else if(rarity==="rare"){
          name=RARE_ADJECTIVES[Math.floor(rng()*RARE_ADJECTIVES.length)]+" "+t.name;
        }
        rItem.name=name;rItem.rarity=rarity;rItem.stats=stats;
        rItem.desc=rarity.charAt(0).toUpperCase()+rarity.slice(1)+" — "+Object.entries(stats).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
        return rItem;
      });
      const prices={common:60,uncommon:180,rare:480,legendary:1400};
      push(``,`🛒 BLACK MARKET — ${getBoro(boro)?.short} (Day ${gs.day})`,`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ...marketItems.map((item,i)=>{
          const rar=ITEM_RARITY[item.rarity]||ITEM_RARITY.common;
          const price=prices[item.rarity];
          const statStr=Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
          return `  ${i+1}. ${rar.prefix}${item.name} [${item.slot}] $${price}`;
        }),
        ``,
        ...marketItems.map((item,i)=>{
          const statStr=Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>(v>0?"+":"")+v+" "+k).join(", ");
          return `     Stats: ${statStr||"none"}`;
        }),
        ``,`BUY MARKET [1-4] to purchase. Resets daily.`);
      return;
    }

    // BUY MARKET [1-4] — buy from today's rolled black market
    const buyMktM=C.match(/^BUY MARKET ([1-4])$/);
    if(buyMktM){
      const idx=parseInt(buyMktM[1])-1;
      const luckBonus=(getItemStats(gs.equipment||{}).luck||0);
      const seed=(gs.day*7+boro.length*3)%ITEM_TEMPLATES.length;
      const todayTemplates=[
        ITEM_TEMPLATES[seed%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+5)%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+11)%ITEM_TEMPLATES.length],
        ITEM_TEMPLATES[(seed+17)%ITEM_TEMPLATES.length],
      ];
      const t=todayTemplates[idx];
      if(!t){push("Invalid slot. Choose 1-4.");return;}
      const mkRng=(n)=>{let s=gs.day*1000+n;return()=>{s=s*16807%2147483647;return(s-1)/2147483646;};};
      const rng=mkRng(idx*99+boro.length);
      const rw=t.weights||{common:50,uncommon:30,rare:15,legendary:5};
      let rr=rng()*(Object.values(rw).reduce((a,b)=>a+b,0)+luckBonus*10);
      let rarity="common";
      for(const [r,w] of Object.entries(rw)){rr-=w;if(rr<=0){rarity=r;break;}}
      const stats={};
      for(const [stat,[min,max]] of Object.entries(t.statRanges||{})){
        const sign=min<0||max<0?-1:1;const absMax=Math.max(Math.abs(min),Math.abs(max));const absMin2=Math.min(Math.abs(min),Math.abs(max));
        const rm={common:0.4,uncommon:0.65,rare:0.85,legendary:1.0}[rarity];
        const v=Math.floor(absMin2+rng()*(absMax-absMin2+1)*rm);
        if(v>0)stats[stat]=sign*v;
      }
      let name=t.name;
      if(rarity==="legendary"){const pfx=LEGENDARY_PREFIXES[Math.floor(rng()*LEGENDARY_PREFIXES.length)];const sfx=(LEGENDARY_SUFFIXES_BY_SLOT[t.slot]||["of the Streets"])[Math.floor(rng()*(LEGENDARY_SUFFIXES_BY_SLOT[t.slot]||["of the Streets"]).length)];name=pfx+" "+t.name+" "+sfx;}
      else if(rarity==="rare"){name=RARE_ADJECTIVES[Math.floor(rng()*RARE_ADJECTIVES.length)]+" "+t.name;}
      const item={_rolled:true,id:t.id+"_mkt_"+gs.day+"_"+idx,templateId:t.id,slot:t.slot,name,rarity,stats,desc:rarity+" drop"};
      const prices={common:60,uncommon:180,rare:480,legendary:1400};
      const price=prices[rarity];
      if(gs.cash<price){push(`Need $${price}. Have $${gs.cash}.`);return;}
      updGs(g=>({...g,cash:g.cash-price,inventory:[...g.inventory,item]}));
      push(`Bought: ${ITEM_RARITY[rarity].prefix}${name} ($${price})`,`Slot: ${t.slot} — EQUIP ${name} to wear it.`);
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
    const useItemM=C.match(/^USE (.+)$/);
    if(useItemM){
      const itemName=useItemM[1].trim();
      const inInv=gs.inventory.find(i=>i.toLowerCase()===itemName.toLowerCase()||i.toLowerCase().includes(itemName.toLowerCase()));
      if(!inInv){push("You don't have "+itemName+" in your inventory.");return;}
      const itemDef=BASE_ITEMS.find(i=>i.name.toLowerCase()===inInv.toLowerCase()||i.id.toLowerCase()===inInv.toLowerCase());
      const eff=itemDef?.effect||{};
      let used=false;let msg="";
      if(eff.heal){
        updGs(g=>({...g,survival:{...g.survival,health:Math.min(100,g.survival.health+eff.heal)},inventory:g.inventory.filter((_,i)=>i!==g.inventory.indexOf(inInv))}));
        msg="Used "+inInv+". Health +"+eff.heal+".";used=true;
      } else if(eff.hunger){
        updGs(g=>({...g,survival:{...g.survival,hunger:Math.min(100,g.survival.hunger+eff.hunger),mental:Math.min(100,(g.survival.mental||70)+(eff.mental||0))},inventory:g.inventory.filter((_,i2)=>i2!==g.inventory.indexOf(inInv))}));
        msg="Used "+inInv+". Hunger +"+eff.hunger+(eff.mental?" Mental +"+eff.mental:"")+".";used=true;
      } else if(eff.energy){
        updGs(g=>({...g,survival:{...g.survival,energy:Math.min(100,g.survival.energy+eff.energy)},inventory:g.inventory.filter((_,i3)=>i3!==g.inventory.indexOf(inInv))}));
        msg="Used "+inInv+". Energy +"+eff.energy+".";used=true;
      } else if(eff.heatReset){
        updGs(g=>({...g,heat:Math.max(0,g.heat-eff.heatReset),inventory:g.inventory.filter((_,i4)=>i4!==g.inventory.indexOf(inInv))}));
        msg="Used Disguise Kit. Heat -"+eff.heatReset+". You look different enough.";used=true;
      } else if(eff.freeMove){
        updGs(g=>({...g,hasMetrocard:true,inventory:g.inventory.filter((_,i5)=>i5!==g.inventory.indexOf(inInv))}));
        msg="MetroCard loaded. Next MOVE is free.";used=true;
      } else {
        // Equippable item — try equipping
        if(itemDef?.slot&&itemDef.slot!=="consumable"){
          push("Type EQUIP "+inInv+" to equip this item.");return;
        }
        push("Can't use "+inInv+" directly. Check INVENTORY for options.");return;
      }
      if(used)push("",msg,"");return;
    }
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
      const addFx=lvl.effects||{};
      const penStr=Object.entries(addFx).filter(([k])=>["hustle","charm","toughness","streetiq"].includes(k)).map(([k,v])=>k+": "+v).join("  ");
      push(`${sub?.icon} ADDICTION — ${sub?.name}`,
        `Level: ${lvl.icon} ${lvl.name} (${gs.addiction||0}/100)`,
        `  ${lvl.desc}`,
        penStr?`  Active stat penalties: ${penStr}`:"  No stat penalties yet.",
        ``,
        `Last used: Day ${gs.lastUsed||0} (${daysSince} day${daysSince!==1?"s":""} ago)`,
        `Withdrawal after: ${withdrawThresh} day${withdrawThresh!==1?"s":""} clean`,
        daysSince>=withdrawThresh&&(gs.addiction||0)>20?"⚠ Currently in withdrawal.":"  Clear for now.",
        ``,
        (gs.addiction||0)>=40?"RECOVERY command to find Carmen's drop-in center.":"",
        (gs.addiction||0)>=80?"  Carmen can help. You just have to show up.":"",
        "USE to intentionally use. Addiction grows with product handling.");
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
      const weapon=gs.equipment?.weapon?(typeof gs.equipment.weapon==="object"&&gs.equipment.weapon._rolled?gs.equipment.weapon:getItemById(gs.equipment.weapon)):null;
      const chest=gs.equipment?.chest?(typeof gs.equipment.chest==="object"&&gs.equipment.chest._rolled?gs.equipment.chest:getItemById(gs.equipment.chest)):null;
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
      push(`🧛 ${feedMsgs[rnd(0,feedMsgs.length-1)]}`,"+$"+cash+". Health +"+healAmt+"hp."+(ancientBlood?" (Ancient Blood — full restore)":""));
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
      if(outcome.cash)updGs(g=>applyXP({...g,mesmerizeCount:(g.mesmerizeCount||0)+1,cash:g.cash+outcome.cash},10,"talk"));
      else if(outcome.heatDown)updGs(g=>applyXP({...g,mesmerizeCount:(g.mesmerizeCount||0)+1,heat:clamp(g.heat-1,0,10)},10,"scout"));
      else updGs(g=>applyXP({...g,mesmerizeCount:(g.mesmerizeCount||0)+1},5,"talk"));
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
          return "  "+q.npc.toUpperCase()+" — \""+q.title+"\" ("+Math.max(0,daysLeft)+"d left)\n    "+q.task;
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
      updGs(g=>({...g,cash:g.cash-amt-fee,wiresSent:(g.wiresSent||0)+1,storyWires:(g.storyWires||0)+1}));
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
      push(`🔧 ALL MARKET PRICES — Day ${gs.day}:`,...BOROUGHS.map(b=>`  ${b.short}: Weed $${mktPrice(b.id,"weed",gs.day,weather,world.supply)} · Pills $${mktPrice(b.id,"pills",gs.day,weather,world.supply)} · Powder $${mktPrice(b.id,"powder",gs.day,weather,world.supply)}`));return;
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
          {msg:"🚔 Heat spiked +"+heatSpike+". Someone talked. "+(exposed?"Word is it was "+gs.name+".":"Source unknown."),time:Date.now()}]},
        worldHistory:[...(world.worldHistory||[]).slice(-49),
          {type:"rat",actor:gs.name,detail:exposed?`${gs.name} informed on ${tName} (exposed)`:`Someone filed a tip on ${tName}`,boro,time:Date.now(),day:gs.day}]};
      setWorld(ws);saveWorld(ws);
      updGs(g=>applyXP({...g,cash:g.cash+pay,informsToday:(g.informsToday||0)+1,
        informCount:(g.informCount||0)+1,
        exposedAsRat:exposed?true:g.exposedAsRat,
        ratHandles:[...new Set([...(g.ratHandles||[]),tName])]},10,"scout"));
      push(`🐀 Tip filed on ${tName}.`,`Handler confirms: +$${pay}.`,exposed?"⚠ Your name came up. Watch your back.":"Source protected.");
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
        updGs(g=>({...g,storyCopEscapes:(g.storyCopEscapes||0)+1,heat:clamp(g.heat-r.heatDrop,0,10),patrolEncountered:false,survival:{...g.survival,energy:clamp(g.survival.energy-r.energyCost,0,100)}}));
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
        "Cash: $"+gs.cash+(overCash?" ⚠ CARRYING TOO MUCH — you're a target":""));
      return;
    }

    // STASH CASH — deposit cash to safe house (keeps it below robbery threshold)
    if(C==="STASH CASH"){
      const safe=world.safehouses?.[boro];
      if(!safe||(safe.owner!==gs.name&&safe.crewOwner!==gs.crew)){push(`No safe house here. BUY SAFEHOUSE $500 first.`);return;}
      const toStash=Math.max(0,gs.cash-100); // keep $100 on you
      if(toStash<=0){push(`Nothing to stash.`);return;}
      const afterStash=gs.cash-toStash;
      updGs(g=>({...g,cash:g.cash-toStash,cashStash:(g.cashStash||0)+toStash}));
      push(`💰 Stashed $${toStash} in safe house.`,`Carrying $${afterStash}. Below the target line.`);return;
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
        const prices=BOROUGHS.map(b=>({b,p:mktPrice(b.id,pKey,gs.day,weather,world.supply)}));
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

    // REGULARS — hooker sees their regular client list
    if(C==="REGULARS"){
      if(!gs.isHooker){push("That command is not for you.");return;}
      const regulars=gs.regulars||0;
      const dailyIncome=regulars*20;
      push("","💄 YOUR REGULARS",
        "Active clients: "+regulars,
        dailyIncome>0?"Passive income: +$"+dailyIncome+"/day (on SLEEP)":"No regulars yet. Each successful CLIENT adds one.",
        "","Each SLEEP adds 1 regular (max 5). Regulars pay while you sleep.");
      return;
    }
    // WANTED POSTERS — view all active wanted posters
    if(C==="WANTED POSTERS"||C==="POSTERS"){
      const bounties=Object.entries(world.bounties||{}).filter(([,v])=>typeof v==="object"?v.amount>0:v>0);
      if(bounties.length===0){push("No active wanted posters. BOUNTY [player] [amount] to post one.");return;}
      push("","⚠ WANTED POSTERS","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        ...bounties.map(([n,b])=>{
          const amt=typeof b==="object"?b.amount:b;
          const poster=typeof b==="object"?b.by:"anon";
          const pData=world.players?.[n];
          const lastBoro=pData?getBoro(pData.borough)?.name:"unknown borough";
          return "☠ "+n+" — $"+amt+" · "+poster+" · Last seen: "+lastBoro;
        }),
        "","Collect by winning FIGHT against the target.");
      return;
    }
    // TITLE — show notoriety and street reputation
    // LEADERBOARD — weekly standings
    if(C==="LEADERBOARD"||C==="RANKINGS"||C==="BOARD"){
      const wk=getWeekNumber();
      const lb=world.leaderboard?.[wk]||{};
      const players=Object.values(lb).filter(e=>typeof e==="object"&&e.name);
      push("","🏆 WEEKLY LEADERBOARD","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "Resets every Monday. Top player in each category wins a title + cash + item.",
        "");
      LEADERBOARD_CATEGORIES.forEach(cat=>{
        const sorted=players.filter(p=>p[cat.id]!=null).sort((a,b)=>(b[cat.id]||0)-(a[cat.id]||0)).slice(0,3);
        push(cat.icon+" "+cat.label+":",
          ...sorted.map((p,i)=>`  ${["🥇","🥈","🥉"][i]} ${p.name}${p.name===gs.name?" (you)":""}: ${p[cat.id]||0}`),
          sorted.length===0?"  No entries yet — play to rank up":"");
      });
      const myEntry=lb[gs.name]||{};
      push("","YOUR STATS THIS WEEK:",
        ...LEADERBOARD_CATEGORIES.map(cat=>`  ${cat.icon} ${cat.label}: ${myEntry[cat.id]||0}`),
        "","Updates each time you SLEEP. Win a category for titles and rewards.");
      return;
    }
    if(C==="TITLE"||C==="MY TITLE"||C==="REPUTATION"){
      const nt=getNotorietyTitle(gs);
      const l=gs.lifetime||{};
      push("","🏆 STREET REPUTATION","━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        gs.title?`Earned title: ${gs.title}`:"No special title yet.",
        nt?`Notoriety: ${nt.icon} ${nt.title}`:"Notoriety: None yet — keep playing.",
        nt?nt.desc:"Titles unlock after Day 10 based on how you play.",
        "",
        "YOUR LIFETIME STATS:",
        `  Days alive: ${l.daysAlive||0}`,
        `  Deals completed: ${l.deals||0}`,
        `  PvP wins: ${l.pvpWins||0}`,
        `  Boss kills: ${l.bossKills||0}`,
        `  NPC conversations: ${l.talkCount||0}`,
        `  Panhandles: ${l.panhandles||0}`,
        `  Cash earned lifetime: $${l.cashEarned||0}`,
        "",
        "TITLES YOU CAN EARN:",
        ...NOTORIETY_TITLES.map(t=>{
          const earned=t.test(l,gs);
          return `${earned?"✓":"○"} ${t.icon} ${t.title} — ${t.desc}`;
        }));
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

  const panelBuy=()=>{
    if(!gs)return;
    const weather=getWeather(gs.day);
    const maxBuy=gs.isHustler?10:8;
    if(mQty>maxBuy){push(`Max ${maxBuy} per trip.`);return;}
    const price=Math.round(mktPrice(boro,mProd,gs.day,weather,world.supply)*PRODUCTS[mProd].bm);
    const total=price*mQty;
    if(total>gs.cash){push(`Need $${total}. Have $${gs.cash}.`);return;}
    // Buy bust at high heat
    const buyBust=gs.heat>7?0.12:gs.heat>5?0.06:0;
    if(buyBust>0&&Math.random()<buyBust){
      const lostQty=Math.ceil(mQty/2);
      updGs(g=>({...g,cash:Math.max(0,g.cash-total),product:{...g.product,[mProd]:Math.max(0,g.product[mProd]+mQty-lostQty)},heat:clamp(g.heat+2,0,10)}));
      push(`Deal went sideways. Got ${mQty-lostQty}× but lost ${lostQty} in the scramble. Heat +2.`);return;
    }
    updGs(g=>applyXP({...g,cash:g.cash-total,product:{...g.product,[mProd]:g.product[mProd]+mQty}},5*mQty,"deal"));
    push(`Bought ${mQty}× ${PRODUCTS[mProd].name} for $${total}.`);
  };
  const panelSell=()=>{
    if(!gs)return;
    const weather=getWeather(gs.day);
    const maxSell=gs.isHustler?8:gs.archetype?.id==="ghost"?7:5;
    if(mQty>maxSell){push(`Max ${maxSell} per transaction.`);return;}
    if(gs.product[mProd]<mQty){push(`Only have ${gs.product[mProd]}.`);return;}
    const price=mktPrice(boro,mProd,gs.day,weather,world.supply);
    const total=price*mQty;
    const b=getBoro(boro);
    const boroHeatMult=(b?.heat||5)/8;
    const hg=Math.max(1,Math.round(mQty*PRODUCTS[mProd].rm*boroHeatMult));
    const copP=getCopPresence(boro,world.copPresence,gs.day)/10;
    const bustBase=mQty>=4?0.15:mQty>=2?0.08:0.04;
    const bustChance=(gs.heat>5||copP>0.7)?bustBase*weather.bustMult*(1+copP):0;
    if(bustChance>0&&Math.random()<bustChance){
      const cashTaken=Math.min(gs.cash,rnd(50,150));
      updGs(g=>({...g,product:{...g.product,[mProd]:0},heat:clamp(g.heat+4,0,10),cash:Math.max(0,g.cash-cashTaken),survival:{...g.survival,mental:clamp((g.survival.mental||70)-10,0,100)}}));
      push(`BUSTED. Product seized. -$${cashTaken}. Heat +4.`);return;
    }
    updGs(g=>applyXP({...g,cash:g.cash+total,product:{...g.product,[mProd]:g.product[mProd]-mQty},heat:clamp(g.heat+hg,0,10)},8*mQty,"deal"));
    // update supply
    const supplyKey=`${boro}_${mProd}_d${gs.day}`;
    const sWs={...world,supply:{...(world.supply||{}),[supplyKey]:((world.supply||{})[supplyKey]||0)+mQty}};
    setWorld(sWs);saveWorld(sWs);
    push(`Sold ${mQty}× ${PRODUCTS[mProd].name}. +$${total}. Heat +${hg}.`);
  };
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
    const itemOrId=gs.equipment?.[slot];if(!itemOrId)return;
    const item=typeof itemOrId==="object"&&itemOrId._rolled?itemOrId:getItemById(itemOrId);
    const invItem=item?._rolled?item:(item?.name||null);
    updGs(g=>({...g,equipment:{...g.equipment,[slot]:null},inventory:invItem?[...g.inventory,invItem]:g.inventory}));
    push(`Unequipped ${item?.name||slot}.`);
  };
  const others=Object.entries(world.players||{}).filter(([n,d])=>n!==gs?.name&&(Date.now()-(d.lastSeen||0))<86400000).map(([n,d])=>({name:n,...d}));

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
        <div style={{fontFamily:"'VT323',monospace",fontSize:42,color:"#e9c46a",letterSpacing:3,textShadow:"0 0 16px #e9c46a55",marginBottom:3}}>HOBO QUEST</div>
        <div style={{fontSize:9,color:"#555",letterSpacing:3,marginBottom:24}}>NEW YORK CITY · SURVIVAL RPG · MULTIPLAYER</div>

        {/* Expanded class preview — selected class gets full card */}
        {selA&&(()=>{
          const a=ARCHETYPES.find(x=>x.id===selA);if(!a)return null;
          const sub=CLASS_SUBSTANCE[a.id];
          const classStories={
            veteran:"Two tours. Honorable discharge. Eighteen months trying to find work before the savings ran out. The bottle got cheaper than therapy. You know every steam vent in midtown by name.",
            schemer:"You had a good run. Three years of careful cons, careful people, careful escapes. Then one target didn't stay fooled. Now you're starting over with smarter enemies and the same brain that got you here.",
            ghost:"Nobody knows your real name. That's on purpose. The people who knew it were the problem. You've been invisible for eight months. Invisible is fine. Invisible is survival.",
            hustler:"The market is wherever you are. Buy low, sell high, move fast, don't get caught. You've been running this math since you were fourteen. The numbers always work out. Usually.",
            junkie:"Hard mode. You know it. The habit cost you the apartment, the job, the people. You're still here though. That counts for something. You just need to make it one more day than yesterday.",
            undocumented:"Three thousand miles to get here. The city doesn't know you exist, which means it can't stop you either. You move through it like water. You've survived worse than New York.",
            vampire:"You arrived in 1987. The city has changed six times since then. You haven't. The hunger is manageable if you're strategic about it. The problem is you've become strategic about everything.",
            fixer:"You know a guy for everything. Plumber. Lawyer. Somebody who can make a problem disappear. That network took twenty years to build. The problem is you owe most of them favors now.",
            rat:"You work both sides. DEA has a file on you. So does the crew you're informing on. The math keeps working as long as nobody compares notes. You've gotten very good at that.",
            drifter:"You and the dog. That's it. That's everything. The dog's name is [name]. You've been together three years and the dog has never once judged any decision you've made. That matters more than you'd expect.",
            schizo:"The city has been speaking to you specifically. You've been writing it down. Seventeen notebooks. The pattern is almost visible. Today might be the day it resolves.",
            hooker:"You know exactly what this city costs and exactly what you can charge for it. The transaction is yours. Everything else is noise.",
          };
          return <div style={{marginBottom:20,border:`1px solid ${a.color}33`,background:`${a.color}06`,padding:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div style={{fontSize:32}}>{a.icon}</div>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:a.color,letterSpacing:3}}>{a.name}</div>
                <div style={{fontSize:8,color:"#555",letterSpacing:1}}>{a.desc}</div>
              </div>
            </div>
            <div style={{fontSize:9,color:"#888",lineHeight:1.7,marginBottom:12,borderLeft:`2px solid ${a.color}33`,paddingLeft:12,fontStyle:"italic"}}>
              {classStories[a.id]?.replace("[name]",["Biscuit","Smoke","Patches","Duke","Gus","Lucky"][Math.floor(Math.random()*6)])||a.desc}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              <div>
                <div style={{fontSize:7,color:"#333",letterSpacing:2,marginBottom:6}}>STATS</div>
                {Object.entries(a.stats).map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontSize:8,color:"#555"}}>{k}</span>
                  <div style={{display:"flex",gap:2}}>
                    {[1,2,3,4,5,6,7,8,9,10].map(n=><div key={n} style={{width:5,height:5,background:n<=v?a.color:"#1a1a1a"}}/>)}
                  </div>
                </div>)}
              </div>
              <div>
                <div style={{fontSize:7,color:"#333",letterSpacing:2,marginBottom:6}}>SUBSTANCE</div>
                <div style={{fontSize:9,color:"#888",marginBottom:8}}>{sub?.icon} {sub?.name}</div>
                <div style={{fontSize:7,color:"#333",letterSpacing:2,marginBottom:6}}>STARTS WITH</div>
                {a.gear.map(g=><div key={g} style={{fontSize:8,color:"#555",marginBottom:2}}>· {g}</div>)}
              </div>
            </div>
            {a.special&&<div style={{fontSize:8,color:a.color+"88",borderTop:`1px solid ${a.color}22`,paddingTop:8,lineHeight:1.6}}>{a.special}</div>}
          </div>;
        })()}

        <div style={{fontSize:9,color:"#333",letterSpacing:2,marginBottom:10}}>// CHOOSE YOUR CLASS</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5,marginBottom:20}}>
          {ARCHETYPES.map(a=><div key={a.id} onClick={()=>setSelA(a.id===selA?null:a.id)} style={{border:`1px solid ${selA===a.id?a.color:"#141414"}`,background:selA===a.id?`${a.color}12`:"#080808",padding:"10px 8px",cursor:"pointer",transition:"all 0.15s",boxShadow:selA===a.id?`0 0 20px ${a.color}22`:"none",textAlign:"center"}}>
            <div style={{fontSize:20,marginBottom:3}}>{a.icon}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:selA===a.id?a.color:"#444",letterSpacing:1}}>{a.name}</div>
            <div style={{fontSize:7,color:"#2a2a2a",marginTop:2}}>${a.startCash}</div>
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
  // ── DEATH SCREEN ──────────────────────────────────────────────────────────
  if(phase==="dead")return(<>
    <style>{FONTS}</style>
    <div style={{minHeight:"100vh",background:"#050505",color:"#c0c0b8",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Share Tech Mono',monospace"}}>
      <div style={{maxWidth:480,width:"100%"}}>
        <div style={{fontFamily:"'VT323',monospace",fontSize:72,color:"#e63946",textShadow:"0 0 40px #e6394688",letterSpacing:4,lineHeight:1,marginBottom:4}}>YOU DIED</div>
        <div style={{fontSize:9,color:"#333",letterSpacing:4,marginBottom:24}}>END OF THE LINE</div>
        {gs&&<div style={{borderLeft:"2px solid #1a1a1a",paddingLeft:16,marginBottom:24}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:gs.archetype?.color||"#888",letterSpacing:2,marginBottom:4}}>
            {gs.archetype?.icon} {gs.name}
          </div>
          <div style={{fontSize:9,color:"#444",marginBottom:16}}>{gs.archetype?.name}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 16px",marginBottom:16}}>
            {[["Days Survived",gs.day],["Level Reached",gs.level],["Cash at Death","$"+(gs.cash||0)],
              ["Total Earned","$"+(gs.lifetime?.cashEarned||0)],["PvP Wins",gs.lifetime?.pvpWins||0],
              ["Deals",gs.lifetime?.deals||0],["Boss Kills",gs.lifetime?.bossKills||0],
              ["Heat at Death",Math.round(gs.heat||0)+"/10"],
              ["Addiction",getAddictionLevel(gs.addiction||0).name],
              ["Corners Held",(gs.cornersOwned||[]).length],
            ].map(([label,val])=><div key={label}>
              <div style={{fontSize:7,color:"#222",letterSpacing:1}}>{label.toUpperCase()}</div>
              <div style={{fontSize:11,color:"#555",fontFamily:"'VT323',monospace"}}>{val}</div>
            </div>)}
          </div>
          {(gs.title||gs.notorietyTitle)&&<div style={{marginBottom:12}}>
            {gs.title&&<div style={{fontSize:8,color:"#e9c46a",letterSpacing:2}}>TITLE: {gs.title}</div>}
          </div>}
          {(gs.addiction||0)>60&&<div style={{fontSize:8,color:"#e63946",marginBottom:12,fontStyle:"italic"}}>
            {getAddictionLevel(gs.addiction).name} at death. The habit outlasted everything else.
          </div>}
          <div style={{marginTop:8,fontSize:9,color:"#2a2a2a",lineHeight:1.6,fontStyle:"italic",borderTop:"1px solid #0d0d0d",paddingTop:12}}>
            {(()=>{
              const d=gs.day;const l=gs.level;
              if(l>=8)return "Made it to Level "+l+". "+d+" days. The city takes everyone eventually. Just slower for some.";
              if(d>=15)return d+" days is more than most. The street remembers.";
              if((gs.lifetime?.pvpWins||0)>=3)return "Took "+(gs.lifetime?.pvpWins||0)+" people down before going down. That counts.";
              return "Day "+d+". Level "+l+". The city keeps moving. It always does.";
            })()}
          </div>
        </div>}
        <div style={{display:"flex",gap:8}}>
          <div onClick={()=>{setGs(null);setPhase("character");}} style={{flex:1,padding:"12px 0",background:"#e9c46a12",border:"1px solid #e9c46a44",color:"#e9c46a",textAlign:"center",cursor:"pointer",fontSize:10,letterSpacing:2,fontFamily:"'Bebas Neue',sans-serif"}}>
            NEW CHARACTER
          </div>
          <div onClick={()=>setPhase("login")} style={{flex:1,padding:"12px 0",background:"transparent",border:"1px solid #1a1a1a",color:"#444",textAlign:"center",cursor:"pointer",fontSize:10,letterSpacing:2,fontFamily:"'Bebas Neue',sans-serif"}}>
            LOAD CHARACTER
          </div>
        </div>
        <div style={{fontSize:7,color:"#111",textAlign:"center",marginTop:16}}>Your legend is on the Wall of Dead.</div>
      </div>
    </div>
  </>);

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
          {gs&&(()=>{
            const tempF=weather?.tempF??68;
            const tempColor=tempF<=25?"#a8dadc":tempF<=40?"#90e0ef":tempF<=60?"#74c69d":tempF<=75?"#e9c46a":tempF<=88?"#f4a261":"#e63946";
            const tempIcon=tempF<=25?"🥶":tempF<=40?"❄️":tempF<=60?"🌥":tempF<=75?"🌤":tempF<=88?"☀️":"🔥";
            return <div style={{fontFamily:"'Share Tech Mono',monospace",fontSize:10,color:tempColor,marginLeft:8,letterSpacing:1,display:"flex",alignItems:"center",gap:3}}>
              <span>{tempIcon}</span>
              <span style={{fontFamily:"'VT323',monospace",fontSize:14}}>{tempF}°F</span>
            </div>;
          })()}
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
              const isRolled=item&&item._rolled;
              const slot=item.slot;
              const oldEquipped=gs.equipment?.[slot];
              const oldItem=oldEquipped?(typeof oldEquipped==="object"&&oldEquipped._rolled?oldEquipped:getItemById(oldEquipped)):null;
              const newInv=gs.inventory.filter(i=>isRolled?(i!==item):(i!==item.name&&i!==item.id));
              if(oldItem)newInv.push(oldItem._rolled?oldItem:oldItem.name);
              const equipVal=isRolled?item:item.id;
              updGs(g=>({...g,equipment:{...g.equipment,[slot]:equipVal},inventory:newInv}));
              push(`Equipped: ${ITEM_RARITY[item.rarity]?.prefix||""}${item.name}`);
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
              if(s===""){return <div key={i} style={{minHeight:6}}/>;} // blank spacer

              // ── Dividers / headers ─────────────────────────────────────────
              const isDivider=s.startsWith("━")||s.startsWith("—")||s.match(/^─+$/);
              if(isDivider)return <div key={i} style={{fontSize:9,color:"#1e1e1e",letterSpacing:2,borderBottom:"1px solid #141414",paddingBottom:3,marginBottom:3,fontFamily:"'Share Tech Mono',monospace"}}>{s}</div>;

              // ── Category detection ─────────────────────────────────────────
              const isCombat   = s.startsWith("⚔")||s.startsWith("💥")||s.startsWith("🥊")||s.startsWith("🔥")||s.startsWith("FIGHT")||s.startsWith("FLEE")||s.includes("damage")||s.includes("HP:")||s.includes("Attack roll")||s.includes("MISS")||s.includes("CRITICAL")||s.startsWith("Round ")||s.includes("combat");
              const isLoot     = s.startsWith("🎁")||s.startsWith("📦")||s.startsWith("💰")||s.includes("LOOT DROP")||s.includes("Acquired:")||s.includes("Bought:")||s.includes("street tax");
              const isLevelUp  = s.startsWith("★")||s.includes("LEVEL UP")||s.includes("Level up")||s.includes("skill point");
              const isWarning  = s.startsWith("⚠")||s.startsWith("🚨")||s.startsWith("☠")||s.startsWith("❄️")||s.startsWith("💀")||s.includes("BUSTED")||s.includes("arrested")||s.includes("YOU DIED")||s.includes("went down");
              const isHeat     = s.includes("Heat +")||s.includes("heat +")||s.includes("HEAT:")||(s.includes("🌡")||s.includes("heat:")&&!s.includes("cold"));
              const isCash     = (s.startsWith("+$")||s.startsWith("-$")||s.match(/^\+\$\d/)||s.includes("+$")&&s.length<40)||s.includes("TRADE COMPLETE")||s.includes("Paid $");
              const isMove     = s.startsWith("🚇")||s.startsWith("🚌")||s.startsWith("Arrived")||s.includes("borough")||s.includes("Borough");
              const isDungeon  = s.startsWith("🏭")||s.startsWith("ROOM ")||s.startsWith("WAREHOUSE")||s.includes("EXTRACT")||s.includes("rooms");
              const isQuest    = s.startsWith("📋")||s.startsWith("✓ Quest")||s.startsWith("⚠ Quest")||s.includes("QUEST")||s.includes("quest");
              const isNarrative= s.startsWith('"')||(s.startsWith("You ")&&!s.includes("$")&&!s.includes("+")&&!s.includes("Heat")&&!s.includes("XP"))||s.startsWith("The street")||s.startsWith("A man")||s.startsWith("An old");
              const isSectionHdr=s.startsWith("—")||s.startsWith("  —")||s.match(/^[A-Z ·]{4,}$/);
              const isCmd      = s.startsWith(">");
              const isStat     = s.includes("·")&&(s.includes("HP")||s.includes("AC")||s.includes("XP")||s.includes("Energy")||s.includes("Hunger"));
              const isBoss     = s.includes("BOSS")||s.includes("Captain")||s.includes("Kingpin")||s.includes("Iceman")||s.includes("Duchess");
              const isMail     = s.startsWith("✉")||s.startsWith("📨")||s.startsWith("📡");
              const isSystem   = s.startsWith("📍")||s.startsWith("Day ")||s.startsWith("DAY ")||s.match(/^━+$/);

              // ── Style resolution ───────────────────────────────────────────
              let color="#d4c9b0";       // default: warm off-white
              let fontSize=12;
              let fontWeight="normal";
              let fontFamily="inherit";
              let background="transparent";
              let borderLeft="none";
              let paddingLeft=0;
              let opacity=1;
              let letterSpacing=0;

              if(isLevelUp){
                color="#e9c46a"; fontWeight="bold"; fontSize=13;
                background="#e9c46a08"; borderLeft="2px solid #e9c46a"; paddingLeft=8;
              } else if(isWarning){
                color="#ff6b6b"; fontWeight="bold";
                borderLeft="2px solid #e6394644"; paddingLeft=6;
              } else if(isBoss){
                color="#f4a261"; fontWeight="bold"; fontSize=13;
                background="#f4a26108"; borderLeft="2px solid #f4a261"; paddingLeft=8;
              } else if(isCombat){
                color="#e07070"; fontSize=12;
                borderLeft="2px solid #e6394622"; paddingLeft=6;
              } else if(isLoot){
                color="#f4a261"; fontWeight="bold";
                borderLeft="2px solid #f4a26144"; paddingLeft=6;
              } else if(isDungeon){
                color="#2a9d8f"; fontSize=12;
                borderLeft="2px solid #2a9d8f33"; paddingLeft=6;
              } else if(isCash){
                color=s.startsWith("-$")||s.includes("Lost")||s.includes("Paid")?"#e07070":"#6aaa6a";
                fontWeight="bold";
              } else if(isHeat){
                color="#e67a3a";
              } else if(isQuest){
                color="#8b8bf4";
                borderLeft="2px solid #8b8bf422"; paddingLeft=6;
              } else if(isMail){
                color="#a8dadc";
              } else if(isStat){
                color="#666"; fontSize=11;
              } else if(isNarrative){
                color="#a09080"; fontSize=12; fontFamily="Georgia, serif";
              } else if(isSectionHdr){
                color="#555"; fontSize=10; letterSpacing=1;
              } else if(isCmd){
                color="#6aaa6a"; fontSize=12;
              } else if(isSystem){
                color="#3a3a3a"; fontSize=10; letterSpacing=1;
              } else if(isMove){
                color="#a8dadc";
              }

              return <div key={i} style={{
                fontSize,color,fontWeight,fontFamily,background,
                borderLeft,paddingLeft,opacity,letterSpacing,
                lineHeight:1.75,
                paddingTop:background!=="transparent"?2:0,
                paddingBottom:background!=="transparent"?2:0,
                marginBottom:background!=="transparent"?2:0,
                borderRadius:background!=="transparent"?2:0,
              }}>{s}</div>;
            })}
            <span style={{color:"#e9c46a",animation:"blink 1.3s infinite",fontSize:12}}>█</span>
              {world.worldEvent&&<span style={{fontSize:8,color:"#e9c46a55",marginRight:6}} title={world.worldEvent.title}>{world.worldEvent.icon}</span>}
              {gs&&gs.crew&&(world.crews?.[gs.crew]?.wars||[]).length>0&&(
                <span style={{fontSize:8,color:"#e63946",letterSpacing:1,fontFamily:"'Share Tech Mono',monospace",marginLeft:8}}>⚔ AT WAR</span>
              )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden",width:185,flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #111",background:"#080808"}}>
            {[["map","MAP"],["market","MKT"],["skills","⚡"],["gear","🗡"],["quests","📋"],["safe","🏠"],["shelter","🛏"],["npcs","NPC"],["chat",unread>0?`📡${unread}`:"📡"],["crews","👥"],["lb","🏆"],["journal","📖"]].map(([id,label])=><div key={id} onClick={()=>{setTab(id);if(id==="chat")setUnread(0);}} style={{flex:1,padding:"5px 0",textAlign:"center",fontSize:8,letterSpacing:1,color:tab===id?"#e9c46a":id==="chat"&&unread>0?"#e63946":"#252525",borderBottom:tab===id?"2px solid #e9c46a":id==="chat"&&unread>0?"2px solid #e63946":"2px solid transparent",animation:id==="chat"&&unread>0?"wanted 1s infinite":"none",cursor:"pointer",minWidth:24}}>{label}</div>)}
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
              {others.map(p=><div key={p.name} style={{fontSize:7,marginBottom:2,display:"flex",justifyContent:"space-between"}}><span style={{color:p.borough===boro?"#e63946":"#1e6e62"}}>● {p.name}{p.notorietyTitle?(" · "+(NOTORIETY_TITLES.find(t=>t.id===p.notorietyTitle)?.icon||"")):"" } · {getBoro(p.borough)?.short}</span>{p.heat>=9&&<span style={{color:"#e63946",fontSize:6}}>🚨</span>}</div>)}</>}
              {Object.entries(world.bounties||{}).filter(([,v])=>typeof v==="object"?v.amount>0:v>0).length>0&&<>
                <div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// BOUNTIES</div>
                {Object.entries(world.bounties||{}).filter(([,v])=>typeof v==="object"?v.amount>0:v>0).map(([n,b])=>{
                  const amt=typeof b==="object"?b.amount:b;
                  const poster=typeof b==="object"?b.by:"anon";
                  const isMe=n===gs.name;
                  return <div key={n} style={{marginBottom:4,padding:"4px 6px",border:`1px solid #e6394633`,background:isMe?"#e6394608":"transparent"}}>
                    <div style={{fontSize:8,color:"#e63946",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>☠ WANTED: {n} {isMe?"← YOU":""}</div>
                    <div style={{fontSize:7,color:"#888"}}>Bounty: ${amt}</div>
                    <div style={{fontSize:6,color:"#444"}}>Posted by {poster} · FIGHT {n} to collect</div>
                  </div>;
                })}
              </>}
              {/* WANTED POSTER — full visual for bounty targets */}
              {(()=>{
                const myBounty=world.bounties?.[gs.name];
                const myAmt=myBounty&&typeof myBounty==="object"?myBounty.amount:myBounty||0;
                if(!(myAmt>0))return null;
                return <div style={{marginTop:8,padding:"8px",border:"2px solid #e63946",background:"#0a0000",textAlign:"center"}}>
                  <div style={{fontSize:9,color:"#e63946",letterSpacing:3,fontFamily:"'Bebas Neue',sans-serif"}}>⚠ WANTED DEAD OR ALIVE ⚠</div>
                  <div style={{fontSize:18,color:"#e9c46a",fontFamily:"'Bebas Neue',sans-serif",margin:"4px 0"}}>{gs.name}</div>
                  <div style={{fontSize:8,color:"#888"}}>{gs.archetype?.name}</div>
                  <div style={{fontSize:14,color:"#e63946",fontFamily:"'Bebas Neue',sans-serif",margin:"4px 0"}}>REWARD: ${myAmt}</div>
                  <div style={{fontSize:6,color:"#555"}}>Last seen: {getBoro(boro)?.name} · Heat: {Math.round(gs.heat)}/10</div>
                </div>;
              })()}
              {(world.pvpLog||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// RECENT HITS</div>{(world.pvpLog||[]).slice(-4).reverse().map((ev,i)=><div key={i} style={{fontSize:7,color:ev.won?"#e63946":"#444",marginBottom:2}}>{ev.attacker}→{ev.victim} · {getBoro(ev.boro)?.short} · {ev.won?`$${ev.stolen}`:"failed"}</div>)}</>}
              {(world.worldHistory||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// WORLD HISTORY</div>{(world.worldHistory||[]).slice(-5).reverse().map((h,i)=><div key={i} style={{fontSize:7,color:"#4a6e4a",marginBottom:2,lineHeight:1.4}}>[Day {h.day}] {h.detail}</div>)}</>}
              {(world.legends||[]).length>0&&<><div style={{fontSize:7,color:"#444",letterSpacing:2,margin:"8px 0 4px"}}>// LEGENDS</div>{(world.legends||[]).slice(-3).reverse().map((l,i)=><div key={i} style={{fontSize:7,color:"#e9c46a",marginBottom:2}}>{l.badge} {l.name} · P{l.prestige}</div>)}</>}
            </>}

            {tab==="market"&&<MktPanel bId={boro} day={gs.day} prod={mProd} setProd={setMProd} qty={mQty} setQty={setMQty} onBuy={panelBuy} onSell={panelSell} playerProd={gs.product} weather={weather} worldSupply={world.supply}/>}
            {tab==="skills"&&<SkillPanel gs={gs} onUnlock={unlockSkill}/>}
            {tab==="quests"&&<QuestPanel gs={gs} npcs={npcs} onAccept={acceptQuest} onComplete={completeQuest} onAbandon={abandonQuest} boro={boro}/>}
            {tab==="gear"&&<div style={{padding:8}}>
              <div style={{fontSize:7,color:"#444",letterSpacing:2,marginBottom:8}}>// EQUIPMENT</div>
              {/* Visual character with slots */}
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                {/* Silhouette */}
                <div style={{width:80,flexShrink:0,position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  {/* Head slot */}
                  {(()=>{const slot="head";const itemId=gs.equipment?.[slot];const item=itemId?getItemById(itemId):null;const rc={common:"#333",uncommon:"#2a9d8f",rare:"#e9c46a",legendary:"#e63946"};
                  return <div style={{width:40,height:40,border:`1px solid ${item?rc[item.rarity]||"#333":"#1a1a1a"}`,background:item?"#0a0a0a":"#060606",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:item?10:6,color:item?rc[item.rarity]:"#222"}}
                    onClick={()=>push("","HEAD: "+(item?.name||"Empty"),item?.desc||"Nothing equipped.",item?Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>"  +"+k+" "+v).join(", "):"Type EQUIP [item] to equip something.","")}
                    title={item?.name||"Head slot"}>
                    {item?"🎭":"👤"}
                  </div>;})()}
                  {/* Body */}
                  <div style={{fontSize:28,lineHeight:1,color:"#1a1a1a",margin:"4px 0",fontFamily:"monospace"}}>
                    {(()=>{const chestRaw=gs.equipment?.chest;const bodyItem=chestRaw?(typeof chestRaw==="object"&&chestRaw._rolled?chestRaw:getItemById(chestRaw)):null;return bodyItem?"🥼":"👕";})()}
                  </div>
                  {/* Feet */}
                  {(()=>{const slot="feet";const itemId=gs.equipment?.[slot];const item=itemId?getItemById(itemId):null;const rc={common:"#333",uncommon:"#2a9d8f",rare:"#e9c46a",legendary:"#e63946"};
                  return <div style={{fontSize:item?12:8,color:item?rc[item.rarity]:"#1a1a1a",cursor:"pointer"}} onClick={()=>push("FEET: "+(item?.name||"Empty"))} title={item?.name||"Feet"}>
                    {item?"👟":"⬜"}
                  </div>;})()}
                </div>
                {/* Slot details */}
                <div style={{flex:1}}>
                  {["head","chest","hands","feet","weapon","accessory"].map(slot=>{
                    const itemId=gs.equipment?.[slot];
                    const item=itemId?getItemById(itemId):null;
                    const rc={common:"#333",uncommon:"#2a9d8f",rare:"#e9c46a",legendary:"#e63946"};
                    const color=item?rc[item.rarity]||"#333":"#1a1a1a";
                    return <div key={slot} style={{display:"flex",alignItems:"center",gap:5,marginBottom:4,padding:"3px 5px",border:`1px solid ${item?"#1a1a1a":"#0d0d0d"}`,background:"#060606",cursor:"pointer"}}
                      onClick={()=>{if(item)push("","["+item.rarity.toUpperCase()+"] "+item.name,item.desc||"","Stats: "+Object.entries(item.stats||{}).filter(([,v])=>v).map(([k,v])=>"+"+k+" "+v).join(", "),"UNEQUIP "+item.name+" to remove.");}}
                    >
                      <div style={{fontSize:7,color:"#222",width:42,letterSpacing:1,flexShrink:0}}>{slot.toUpperCase()}</div>
                      <div style={{flex:1,fontSize:7,color,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {item?item.name:"—"}
                      </div>
                      {item&&<div style={{fontSize:6,color:"#333"}}>{Object.entries(item.stats||{}).filter(([,v])=>v&&v!==0).slice(0,2).map(([k,v])=>"+"+v+" "+k.slice(0,3)).join(" ")}</div>}
                    </div>;
                  })}
                </div>
              </div>
              {/* Addiction bar */}
              {(gs.addiction||0)>0&&(()=>{
                const al=getAddictionLevel(gs.addiction||0);
                const pct=((gs.addiction||0)/100)*100;
                return <div style={{marginTop:8,marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <div style={{fontSize:7,color:"#333",letterSpacing:1}}>ADDICTION</div>
                    <div style={{fontSize:7,color:al.color}}>{al.icon} {al.name}</div>
                  </div>
                  <div style={{height:4,background:"#111",borderRadius:2}}>
                    <div style={{height:"100%",width:pct+"%",background:al.color,borderRadius:2,transition:"width 0.3s"}}/>
                  </div>
                  {(gs.addiction||0)>=40&&<div style={{fontSize:6,color:"#333",marginTop:2}}>Type RECOVERY to find Carmen's drop-in center</div>}
                </div>;
              })()}
              {/* Total gear stats */}
              {(()=>{
                const eq=getItemStats(gs.equipment||{});
                const statKeys=Object.entries(eq).filter(([,v])=>v&&v!==0);
                if(statKeys.length===0)return null;
                return <div style={{borderTop:"1px solid #0d0d0d",paddingTop:6,marginTop:4}}>
                  <div style={{fontSize:7,color:"#222",letterSpacing:1,marginBottom:4}}>TOTAL BONUSES</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                    {statKeys.map(([k,v])=><div key={k} style={{fontSize:7,color:"#2a9d8f",padding:"1px 5px",border:"1px solid #0d2a1e"}}>+{v} {k}</div>)}
                  </div>
                </div>;
              })()}
              <div style={{marginTop:8,fontSize:7,color:"#1a1a1a"}}>EQUIP [item] · UNEQUIP [slot] · INVENTORY</div>
            </div>}
            {tab==="gear_OLD"&&<GearPanel gs={gs} onUnequip={unequipSlot} onEquip={(slot)=>{
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
                  {(wMsgs||[]).slice(-30).filter(m=>!m.crewOnly||(m.crewOnly===gs.crew)||m.from===gs.name).map((m,i)=>{
                    const isMe=m.from===gs.name;
                    const isCrew=!!m.crewOnly;
                    const mc=isCrew?"#06d6a0":aColors[m.arch]||"#2a9d8f";
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
                  <input value={mIn} onChange={e=>{setMIn(e.target.value);}} onKeyDown={e=>{if(e.key==="Enter")sendMsg();}} placeholder="say something..." maxLength={200} autoComplete="off"
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
            {tab==="lb"&&<div style={{padding:8,color:"#e9c46a"}}>
              <div style={{fontSize:7,color:"#444",letterSpacing:2,marginBottom:8}}>// WEEKLY LEADERBOARD</div>
              {(()=>{
                const wk=getWeekNumber();
                const lb=world.leaderboard?.[wk]||{};
                const players=Object.values(lb).filter(e=>typeof e==="object"&&e.name);
                return <div>
                  {LEADERBOARD_CATEGORIES.map(cat=>{
                    const sorted=players.filter(p=>p[cat.id]!=null).sort((a,b)=>(b[cat.id]||0)-(a[cat.id]||0)).slice(0,3);
                    return <div key={cat.id} style={{marginBottom:10}}>
                      <div style={{fontSize:7,color:"#555",letterSpacing:1,marginBottom:3}}>{cat.icon} {cat.label.toUpperCase()}</div>
                      {sorted.length===0&&<div style={{fontSize:7,color:"#333"}}>No entries yet</div>}
                      {sorted.map((p,i)=><div key={p.name} style={{fontSize:7,color:p.name===gs.name?"#e9c46a":"#888",marginBottom:2,display:"flex",justifyContent:"space-between"}}>
                        <span>{["🥇","🥈","🥉"][i]} {p.name}{p.name===gs.name?" ★":""}</span>
                        <span style={{color:"#555"}}>{p[cat.id]||0}</span>
                      </div>)}
                    </div>;
                  })}
                  <div style={{fontSize:6,color:"#333",marginTop:8,borderTop:"1px solid #111",paddingTop:6}}>
                    Resets Monday. Winner gets title + cash + item.
                  </div>
                </div>;
              })()}
            </div>}
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

        {/* DUNGEON / WAREHOUSE RUN HUD */}
        {dungeon&&dungeon.status==="active"&&(
          <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#060606ee",borderTop:"1px solid #2a9d8f44",padding:"8px 14px",fontFamily:"'Share Tech Mono',monospace",zIndex:90,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:"#2a9d8f",letterSpacing:2,whiteSpace:"nowrap"}}>🏭 {dungeon.warehouseName}</span>
              {/* Room progress dots */}
              <div style={{display:"flex",gap:3}}>
                {dungeon.rooms.map((_,i)=>(
                  <div key={i} style={{width:8,height:8,borderRadius:"50%",
                    background:i<dungeon.currentRoom?"#2a9d8f":i===dungeon.currentRoom?"#e9c46a":"#1a1a1a",
                    border:"1px solid "+(i<dungeon.currentRoom?"#2a9d8f44":i===dungeon.currentRoom?"#e9c46a":"#222")}}/>
                ))}
              </div>
              <span style={{fontSize:8,color:"#666",whiteSpace:"nowrap"}}>Room {Math.min(dungeon.currentRoom+1,dungeon.rooms.length)}/{dungeon.rooms.length}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              {dungeon.cashFound>0&&<span style={{fontSize:9,color:"#e9c46a"}}>💰${dungeon.cashFound}</span>}
              {dungeon.loot.length>0&&<span style={{fontSize:9,color:"#f4a261"}}>📦{dungeon.loot.length}</span>}
              <div onClick={()=>handleCmd("ADVANCE")} style={{padding:"4px 10px",background:"#2a9d8f20",border:"1px solid #2a9d8f",color:"#2a9d8f",cursor:"pointer",fontSize:9,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>ADVANCE</div>
              <div onClick={()=>handleCmd("EXTRACT")} style={{padding:"4px 8px",background:"transparent",border:"1px solid #333",color:"#555",cursor:"pointer",fontSize:9,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:1}}>EXTRACT</div>
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
                    setWorld(ws);saveWorld(ws);setWMsgs(ws.messages||[]);
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

        {/* TOAST NOTIFICATION */}
        {toast&&(()=>{
          const aColors={veteran:"#e63946",schemer:"#f4a261",ghost:"#a8dadc",hustler:"#2a9d8f",junkie:"#e9c46a",undocumented:"#f4a261",vampire:"#9d4edd",fixer:"#06d6a0",rat:"#ff6b6b",drifter:"#c9a96e",schizo:"#c77dff",hooker:"#ff4d8d"};
          const mc=aColors[toast.arch]||"#2a9d8f";
          return <div style={{position:"absolute",top:50,right:16,zIndex:100,background:"#0d0f0f",border:`1px solid ${mc}44`,padding:"6px 10px",maxWidth:220,animation:"fadeIn 0.2s ease",pointerEvents:"none"}}>
            <div style={{display:"flex",gap:5,alignItems:"center"}}>
              <span style={{color:mc,fontSize:8,fontFamily:"'Share Tech Mono',monospace",fontWeight:"bold"}}>📡 {toast.from}</span>
              <span style={{color:"#555",fontSize:6}}>{new Date(toast.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
            </div>
            <div style={{color:"#bbb",fontSize:8,marginTop:2,lineHeight:1.4,wordBreak:"break-word"}}>{toast.text}</div>
          </div>;
        })()}

        {/* PERSISTENT CHAT STRIP */}
        {gs&&chatStrip&&(()=>{
          const aColors={veteran:"#e63946",schemer:"#f4a261",ghost:"#a8dadc",hustler:"#2a9d8f",junkie:"#e9c46a",undocumented:"#f4a261",vampire:"#9d4edd",fixer:"#06d6a0",rat:"#ff6b6b",drifter:"#c9a96e",schizo:"#c77dff",hooker:"#ff4d8d"};
          const recentMsgs=(wMsgs||[]).filter(m=>m.from&&m.from!==gs.name).slice(-3);
          return <div style={{borderTop:"1px solid #111",background:"#060606",padding:"3px 12px",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
              <div style={{fontSize:6,color:"#333",letterSpacing:1}}>
                📡 WORLD CHAT
                {unread>0&&<span style={{color:"#e63946",marginLeft:4,animation:"wanted 1s infinite"}}> {unread} NEW</span>}
              </div>
              <div style={{display:"flex",gap:6}}>
                <div onClick={()=>setChatStrip(false)} style={{fontSize:6,color:"#222",cursor:"pointer"}}>hide</div>
                <div onClick={()=>{setTab("chat");setUnread(0);if(inputRef.current)inputRef.current.focus();}} style={{fontSize:6,color:"#444",cursor:"pointer"}}>expand ↗</div>
              </div>
            </div>
            {recentMsgs.length===0&&<div style={{fontSize:7,color:"#1a1a1a",fontStyle:"italic"}}>No recent messages. Type /message to chat.</div>}
            {recentMsgs.map((m,i)=>{
              const mc=aColors[m.arch]||"#2a9d8f";
              return <div key={i} style={{display:"flex",gap:5,alignItems:"baseline",marginBottom:1}}>
                <span style={{color:mc,fontSize:7,flexShrink:0,minWidth:60,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.from}</span>
                <span style={{color:"#888",fontSize:8,lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{m.text}</span>
                <span style={{color:"#222",fontSize:6,flexShrink:0}}>{m.time?new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):""}</span>
              </div>;
            })}
            {typingUser&&<div style={{fontSize:6,color:"#333",fontStyle:"italic"}}>{typingUser} is typing...</div>}
          </div>;
        })()}
        {gs&&!chatStrip&&<div onClick={()=>setChatStrip(true)} style={{borderTop:"1px solid #111",background:"#060606",padding:"3px 12px",fontSize:6,color:"#333",cursor:"pointer",flexShrink:0}}>📡 show chat strip</div>}

        {/* BOTTOM */}
        <div style={{borderTop:"1px solid #111",display:"flex",alignItems:"center",padding:"0 16px",gap:7,background:"#080808",minHeight:46,flexShrink:0}}>
          <span style={{color:"#f4d03f",fontSize:13,flexShrink:0}}>▶</span>
          <input ref={inputRef} value={cmd} onChange={e=>setCmd(e.target.value)} onKeyDown={handleCmd} placeholder={(()=>{
              if(!gs)return "command  ·  /message to chat";
              if(gs.survival.health<30)return "⚠ Health critical — REST or EAT";
              if(gs.heat>7)return "🚔 Heat critical — LAY LOW · SKIP TOWN · HIDE";
              if(gs.survival.hunger<20)return "🍽 Starving — EAT or BODEGA";
              if(gs.survival.energy<15)return "😴 Exhausted — REST or SLEEP";
              if(gs.survival.mental<20)return "🧠 Mental breaking — MENTAL · CONFESS";
              if((gs.addiction||0)>=80)return "💊 "+getAddictionLevel(gs.addiction).name+" — RECOVERY to find Carmen";
              if(gs.day===1&&(gs.tutStep||0)<7)return "Day 1 — follow tutorial steps";
              const contracts=world.contracts||[];const myC=gs.contractsCompleted||[];const pending=contracts.filter(c=>!myC.includes(c.id));
              if(pending.length>0)return "📋 "+pending.length+" contracts active — CONTRACTS";
              return "command  ·  /message to chat  ·  //crew";
            })()} autoFocus onBlur={e=>{setTimeout(()=>{try{e.target.focus();}catch{}},100);}} style={{flex:1,background:"transparent",border:"none",outline:"none",color:"#f4d03f",fontFamily:"'Share Tech Mono',monospace",fontSize:14,letterSpacing:1,minWidth:0}}/>
          <div onClick={()=>inputRef.current?.focus()} style={{fontSize:8,color:"#666",padding:"4px 8px",border:"1px solid #1a1a1a",cursor:"pointer",flexShrink:0}}>ENTER ↵</div>
        </div>

      </div>
    </>);
  }
  return null;
}
