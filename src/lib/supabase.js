import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: { eventsPerSecond: 10 }
  }
})

// ── WORLD OPERATIONS ─────────────────────────────────────────

export async function loadWorld() {
  const { data, error } = await supabase
    .from('world')
    .select('*')
    .eq('id', 1)
    .single()
  if (error) throw error
  return data
}

export async function saveWorld(worldData) {
  // Handle both camelCase (from game) and snake_case (from DB) keys
  const corners = worldData.corners || {}
  const players = worldData.players || {}
  const crews = worldData.crews || {}
  const messages = worldData.messages || []
  const player_alerts = worldData.playerAlerts || worldData.player_alerts || {}
  const pvp_log = worldData.pvpLog || worldData.pvp_log || []
  const wall_of_dead = worldData.wallOfDead || worldData.wall_of_dead || []
  const safehouses = worldData.safehouses || {}
  const supply = worldData.supply || {}
  const cop_presence = worldData.copPresence || worldData.cop_presence || {}
  const captain_boro = worldData.captainBoro || worldData.captain_boro || null
  const captain_day = worldData.captainDay || worldData.captain_day || 0
  const world_history = worldData.worldHistory || worldData.world_history || []
  const legends = worldData.legends || []
  const shelter_checkins = worldData.shelterCheckins || worldData.shelter_checkins || {}
  const letters = worldData.letters || []
  const notifications = worldData.notifications || []
  const bounties = worldData.bounties || {}

  const { error } = await supabase
    .from('world')
    .upsert({
      id: 1,
      corners,
      players,
      crews,
      messages: messages.slice(-50),
      pvp_log: pvp_log.slice(-30),
      bounties,
      wall_of_dead: wall_of_dead.slice(-20),
      player_alerts,
      safehouses,
      supply,
      cop_presence,
      captain_boro,
      captain_day,
      world_history: world_history.slice(-50),
      legends: legends.slice(-20),
      shelter_checkins,
      letters: letters.slice(-30),
      notifications,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ── CHARACTER OPERATIONS ──────────────────────────────────────

import CryptoJS from 'crypto-js'

export function hashPin(name, pin) {
  return CryptoJS.SHA256(`${name.toLowerCase()}:${pin}`).toString()
}

export async function loadCharacter(name, pin) {
  const pinHash = hashPin(name, pin)
  const { data, error } = await supabase
    .from('characters')
    .select('*')
    .eq('name', name)
    .eq('pin_hash', pinHash)
    .single()
  if (error || !data) return null
  return dbToGameState(data)
}

export async function saveCharacter(gs, pin) {
  if (!gs || !pin) return
  const pinHash = hashPin(gs.name, pin)
  const dbData = gameStateToDb(gs, pinHash)
  const { error } = await supabase
    .from('characters')
    .upsert(dbData, { onConflict: 'name,pin_hash' })
  if (error) console.error('Save error:', error)
}

// ── REAL-TIME SUBSCRIPTIONS ───────────────────────────────────

// Direct message send — bypasses full saveWorld for speed
export async function sendChatMessage(message) {
  // First get current messages
  const { data } = await supabase.from('world').select('messages').eq('id', 1).single()
  const current = data?.messages || []
  const newMessages = [...current.slice(-49), message]
  const { error } = await supabase
    .from('world')
    .update({ messages: newMessages, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw error
  return newMessages
}

export function subscribeToWorld(callback) {
  return supabase
    .channel('world-changes')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'world',
      filter: 'id=eq.1'
    }, payload => callback(payload.new))
    .subscribe()
}

export function unsubscribe(channel) {
  supabase.removeChannel(channel)
}

// ── DATA MAPPERS ──────────────────────────────────────────────
// Convert between game state (camelCase) and DB columns (snake_case)

function gameStateToDb(gs, pinHash) {
  return {
    name: gs.name,
    pin_hash: pinHash,
    archetype_id: gs.archetype?.id || 'veteran',
    archetype_data: gs.archetype || {},
    level: gs.level,
    xp: gs.xp,
    cash: gs.cash,
    heat: gs.heat,
    day: gs.day,
    stats: gs.stats,
    survival: gs.survival,
    inventory: gs.inventory,
    product: gs.product,
    cooked: gs.cooked,
    equipment: gs.equipment,
    skills: gs.skills,
    skill_points: gs.skillPoints,
    corners_owned: gs.cornersOwned,
    rep: gs.rep,
    crew: gs.crew,
    crew_role: gs.crewRole,
    wanted: gs.wanted,
    ghost_mode: gs.ghostMode,
    backstory: gs.backstory,
    journal: (gs.journal || []).slice(-50),
    addiction: gs.addiction,
    last_used: gs.lastUsed,
    withdrawal_day: gs.withdrawalDay,
    active_quests: gs.activeQuests,
    completed_quests: gs.completedQuests,
    quest_progress: gs.questProgress,
    hustle_count: gs.hustleCount,
    hustle_boros: gs.hustleBoros,
    hustle_boro_last: gs.hustleBoroLast,
    debt_owed: gs.debtOwed,
    cash_stash: gs.cashStash,
    prestige: gs.prestige,
    is_vampire: gs.isVampire,
    is_fixer: gs.isFixer,
    is_rat: gs.isRat,
    is_junkie: gs.isJunkie,
    is_undoc: gs.isUndoc,
    is_hustler: gs.isHustler,
    thralls: gs.thralls,
    feed_count: gs.feedCount,
    feed_used: gs.feedUsed,
    informs_today: gs.informsToday,
    exposed_as_rat: gs.exposedAsRat,
    brokered_deals: gs.brokeredDeals,
    rat_handles: gs.ratHandles,
    patrol_encountered: gs.patrolEncountered,
    wanted_stars: gs.wantedStars,
    retire_eligible: gs.retireEligible,
    xp_mult: gs.xpMult,
    high_active: gs.highActive,
    dominate_used: gs.dominateUsed,
    panic_used: gs.panicUsed,
    bluff_used: gs.bluffUsed,
    saved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function dbToGameState(row) {
  return {
    name: row.name,
    archetype: row.archetype_data,
    level: row.level,
    xp: row.xp,
    cash: row.cash,
    heat: parseFloat(row.heat),
    day: row.day,
    stats: row.stats,
    survival: row.survival,
    inventory: row.inventory,
    product: row.product,
    cooked: row.cooked,
    equipment: row.equipment,
    skills: row.skills,
    skillPoints: row.skill_points,
    cornersOwned: row.corners_owned,
    rep: row.rep,
    crew: row.crew,
    crewRole: row.crew_role,
    wanted: row.wanted,
    ghostMode: row.ghost_mode,
    backstory: row.backstory,
    journal: row.journal,
    addiction: row.addiction,
    lastUsed: row.last_used,
    withdrawalDay: row.withdrawal_day,
    activeQuests: row.active_quests,
    completedQuests: row.completed_quests,
    questProgress: row.quest_progress,
    hustleCount: row.hustle_count,
    hustleBoros: row.hustle_boros,
    hustleBoroLast: row.hustle_boro_last,
    debtOwed: row.debt_owed,
    cashStash: row.cash_stash,
    prestige: row.prestige,
    isVampire: row.is_vampire,
    isFixer: row.is_fixer,
    isRat: row.is_rat,
    isJunkie: row.is_junkie,
    isUndoc: row.is_undoc,
    isHustler: row.is_hustler,
    thralls: row.thralls,
    feedCount: row.feed_count,
    feedUsed: row.feed_used,
    informsToday: row.informs_today,
    exposedAsRat: row.exposed_as_rat,
    brokeredDeals: row.brokered_deals,
    ratHandles: row.rat_handles,
    patrolEncountered: row.patrol_encountered,
    wantedStars: row.wanted_stars,
    retireEligible: row.retire_eligible,
    xpMult: parseFloat(row.xp_mult),
    highActive: row.high_active,
    dominateUsed: row.dominate_used,
    panicUsed: row.panic_used,
    bluffUsed: row.bluff_used,
  }
}
