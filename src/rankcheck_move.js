'use strict'

///////////////////////////////////////////////
// main

async function get_rankcheck_move(rank_profile,
                                  peek_kata_raw_human_nn, update_ponder_surely) {
    // param
    const policy_profile = rank_profile || 'rank_9d'
    const rank_delta = 2, profile_pair = profiles_around(policy_profile, rank_delta)
    const max_candidates = 8, policy_move_prob = 0.1
    // util
    const peek = (moves, profile) =>
          new Promise((res, rej) => peek_kata_raw_human_nn(moves, profile, res))
    const evaluate = async move => eval_move(move, profile_pair, peek)
    const ret = (move, comment) => (update_ponder_surely(), [move, comment])
    // proc
    const p0 = (await peek([], policy_profile)).policy
    const randomly_picked_policy = weighted_random_choice(p0, z => z || 0)
    // To avoid becoming too repetitive,
    // occasionally play randomly_picked_policy move.
    if (Math.random() < policy_move_prob) {
        const selected = serial2move(p0.indexOf(randomly_picked_policy))
        const order = sort_policy(p0).indexOf(randomly_picked_policy)
        const comment = `(rankcheck) by ${policy_profile} policy: ` +
              `${round(randomly_picked_policy)} (order ${order})`
        return ret(selected, comment)
    }
    // To exclude minor moves naturally,
    // use randomly_picked_policy as the lower bound.
    const top_indices_raw = get_top_indices(p0, max_candidates)
    const top_indices = top_indices_raw.filter(k => p0[k] >= randomly_picked_policy)
    const top_policies = top_indices.map(k => p0[k])
    const top_moves = top_indices.map(serial2move)
    const evals = await ordered_async_map(top_moves, evaluate)
    const selected = min_by(top_moves, (_, k) => evals[k][0])
    const comment = `(rankcheck ${profile_pair.join('/')}) ` +
          `Select ${selected} from [${top_moves.join(',')}].\n` +
          `policy = [${round(top_policies).join(', ')}]\n` +
          `eval = ${JSON.stringify(round(evals))}`
    return ret(selected, comment)
}

async function eval_move(move, profile_pair, peek) {
    // param
    const winrate_samples = 5, evenness_coef = 0.1
    const winrate_profile = null  // null = normal katago
    // util
    const peek_policies = async profiles => {
        const f = async prof => (await peek([move], prof)).policy
        return ordered_async_map(profiles, f)
    }
    const peek_winrates = async ms => {
        const f = async m =>
              [m, (await peek([move, m], winrate_profile)).whiteWin[0]]
        return aa2hash(await ordered_async_map(ms, f))
    }
    const get_candidates = p => {
        const indices = get_top_indices(p, winrate_samples)
        const moves = indices.map(serial2move)
        const policies = indices.map(k => p[k])
        return {indices, moves, policies}
    }
    const expected_white_winrate = (candidates, union_wwin) => {
        const {moves, policies} = candidates
        const wwin = moves.map(m => union_wwin[m])
        return sum(moves.map((_, k) => wwin[k] * policies[k])) / sum(policies)
    }
    // proc
    const policies_pair = await peek_policies(profile_pair)
    const candidates_pair = policies_pair.map(get_candidates)
    const union_moves = uniq(candidates_pair.flatMap(c => c.moves))
    const union_wwin = await peek_winrates(union_moves)
    const white_winrate_pair =
          candidates_pair.map(c => expected_white_winrate(c, union_wwin))
    // eval from opponent (= human) side
    const from_white_p = is_bturn(), flip = ww => from_white_p ? ww : 1 - ww
    const [wr_s, wr_w] = white_winrate_pair.map(flip)
    const mean = (wr_s + wr_w) / 2, diff = wr_s - wr_w
    // maximize "diff" and keep "mean" near 0.5
    const badness = (diff - 1)**2 + evenness_coef * (mean - 1/2)**2
    return [badness, wr_s, wr_w]
}

///////////////////////////////////////////////
// util

function profiles_around(rank_profile, delta) {
    return [-1, +1].map(sign => prof_add(rank_profile, sign * delta))
}

function prof_add(rank_profile, delta) {
    const a = humansl_rank_profiles, k = a.indexOf(rank_profile) + delta
    return a[clip(k, 0, a.length - 1)]
}

function sort_policy(a) {return num_sort(a.filter(truep)).reverse()}

function get_top_indices(a, k) {
    return sort_policy(a).slice(0, k).map(z => a.indexOf(z))
}

function round(z) {return is_a(z, 'number') ? to_f(z.toFixed(3)) : z.map(round)}

async function ordered_async_map(a, f) {
    const iter = async (acc, ...args) => {
        const prev = await acc; return [...prev, await f(...args)]
    }
    return a.reduce(iter, Promise.resolve([]))
}

///////////////////////////////////////////////
// exports

module.exports = {
    get_rankcheck_move,
}