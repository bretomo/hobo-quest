import { createClient } from '@supabase/supabase-js'
import CryptoJS from 'crypto-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
export const supabase = createClient(supabaseUrl, supabaseKey)

export function hashPin(name, pin) {
  return CryptoJS.SHA256(`${name.toLowerCase()}:${pin}`).toString()
}

export async function loadWorld() {
  const { data, error } = await supabase.from('world').select('*').eq('id', 1).single()
  if (error) return null
  return data
}

export async function saveWorld(w) {
  await supabase.from('world').upsert({ id: 1, ...w, updated_at: new Date().toISOString() })
}

export async function loadCharacter(name, pin) {
  const pinHash = hashPin(name, pin)
  const { data } = await supabase.from('characters').select('*').eq('name', name).eq('pin_hash', pinHash).single()
  if (!data) return null
  return dbToGameState(data)
}

export async function saveCharacter(gs, pin) {
  if (!gs || !pin) return
  const pinHash = hashPin(gs.name, pin)
  await supabase.from('characters').upsert(gameStateToDb(gs, pinHash), { onConflict: 'name,pin_hash' })
}

export function subscribeToWorld(callback) {
  return supabase.channel('world').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'world', filter: 'id=eq.1' }, payload => callback(payload.new)).subscribe()
}

export function unsubscribe(channel) { supabase.removeChannel(channel) }

function gameStateToDb(gs, pinHash) {
  return {
    name: gs.name, pin_hash: pinHash,
    archetype_id: gs.archetype?.id || 'veteran', archetype_data: gs.archetype || {},
    level: gs.level, xp: gs.xp, cash: gs.cash, heat: gs.heat, day: gs.day,
    stats: gs.stats, survival: gs.survival, inventory: gs.inventory,
    product: gs.product, cooked: gs.cooked, equipment: gs.equipment,
    skills: gs.skills, skill_points: gs.skillPoints, corners_owned: gs.cornersOwned,
    rep: gs.rep, crew: gs.crew, crew_role: gs.crewRole, wanted: gs.wanted,
    ghost_mode: gs.ghostMode, backstory: gs.backstory,
    journal: (gs.journal||[]).slice(-50), addiction: gs.addiction,
    last_used: gs.lastUsed, withdrawal_day: gs.withdrawalDay,
    active_quests: gs.activeQuests, completed_quests: gs.completedQuests,
    quest_progress: gs.questProgress, hustle_count: gs.hustleCount,
    hustle_boros: gs.hustleBoros, hustle_boro_last: gs.hustleBoroLast,
    debt_owed: gs.debtOwed, cash_stash: gs.cashStash, prestige: gs.prestige,
    is_vampire: gs.isVampire, is_fixer: gs.isFixer, is_rat: gs.isRat,
    is_junkie: gs.isJunkie, is_undoc: gs.isUndoc, is_hustler: gs.isHustler,
    thralls: gs.thralls, feed_count: gs.feedCount, feed_used: gs.feedUsed,
    informs_today: gs.informsToday, exposed_as_rat: gs.exposedAsRat,
    brokered_deals: gs.brokeredDeals, rat_handles: gs.ratHandles,
    patrol_encountered: gs.patrolEncountered, wanted_stars: gs.wantedStars,
    xp_mult: gs.xpMult, high_active: gs.highActive, panic_used: gs.panicUsed,
    updated_at: new Date().toISOString(),
  }
}

function dbToGameState(row) {
  return {
    name: row.name, archetype: row.archetype_data,
    level: row.level, xp: row.xp, cash: row.cash,
    heat: parseFloat(row.heat), day: row.day,
    stats: row.stats, survival: row.survival, inventory: row.inventory,
    product: row.product, cooked: row.cooked, equipment: row.equipment,
    skills: row.skills, skillPoints: row.skill_points, cornersOwned: row.corners_owned,
    rep: row.rep, crew: row.crew, crewRole: row.crew_role, wanted: row.wanted,
    ghostMode: row.ghost_mode, backstory: row.backstory, journal: row.journal,
    addiction: row.addiction, lastUsed: row.last_used, withdrawalDay: row.withdrawal_day,
    activeQuests: row.active_quests, completedQuests: row.completed_quests,
    questProgress: row.quest_progress, hustleCount: row.hustle_count,
    hustleBoros: row.hustle_boros, hustleBoroLast: row.hustle_boro_last,
    debtOwed: row.debt_owed, cashStash: row.cash_stash, prestige: row.prestige,
    isVampire: row.is_vampire, isFixer: row.is_fixer, isRat: row.is_rat,
    isJunkie: row.is_junkie, isUndoc: row.is_undoc, isHustler: row.is_hustler,
    thralls: row.thralls, feedCount: row.feed_count, feedUsed: row.feed_used,
    informsToday: row.informs_today, exposedAsRat: row.exposed_as_rat,
    brokeredDeals: row.brokered_deals, ratHandles: row.rat_handles,
    patrolEncountered: row.patrol_encountered, wantedStars: row.wanted_stars,
    xpMult: parseFloat(row.xp_mult||1), highActive: row.high_active, panicUsed: row.panic_used,
  }
}
