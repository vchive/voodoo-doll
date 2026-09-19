// Generated from pi-agent-team 0.3.0; see NOTICE.md.
import { createHash, randomUUID } from "node:crypto";
import { assertValidMemberId } from "./domain.js";
export const REPORTER_RESOURCE = "reporter";
export class TeamRuntime {
    objective;
    agents;
    options;
    teamId;
    observations = new Map();
    disabledObservers = new Set();
    envelopes = [];
    groups = new Map();
    events = [];
    finished = new Map();
    errored = new Map();
    blocked = new Map();
    turns = new Map();
    ready = new Set();
    flushing = new Set();
    readyCause = new Map();
    claims = new Map();
    polls = new Map();
    closedPolls = new Map();
    readyPolls = new Set();
    states = new Map();
    openingWaveMembers = null;
    openingWaveDrafted = new Set();
    heldBackForReveal = new Map();
    activitySequence = 0;
    auditHead = "0".repeat(64);
    recent = "Team created";
    started = false;
    userInterventions;
    resolveIntervention;
    settled = false;
    claimedReporter;
    constructor(objective, agents, options = {}, teamId = randomUUID(), initialUserInterventions = 0){
        this.objective = objective;
        this.agents = agents;
        this.options = options;
        this.teamId = teamId;
        this.userInterventions = initialUserInterventions;
        if (agents.size < 2) throw new Error("A team requires at least two agents");
        for (const [id, agent] of agents){
            if (id !== agent.member.id) throw new Error(`Agent map identity mismatch: ${id}`);
            assertValidMemberId(id);
            this.observations.set(id, []);
            this.turns.set(id, 0);
            this.states.set(id, "idle");
        }
        const sessionIds = [
            ...agents.values()
        ].map((agent)=>agent.sessionId);
        if (new Set(sessionIds).size !== sessionIds.length) throw new Error("Agent session IDs must be unique");
        if (options.reporterId !== undefined && !agents.has(options.reporterId)) throw new Error(`Unknown reporterId: ${options.reporterId}`);
    }
    async run(initial, signal) {
        if (this.started) throw new Error("TeamRuntime.run() may only be called once per round; call next() to continue the team");
        this.started = true;
        try {
            return await this.execute(initial, signal);
        } finally{
            this.settled = true;
        }
    }
    hasMember(memberId) {
        return this.agents.has(memberId);
    }
    next(objective, options = {}, requesterInitiated = false) {
        if (!this.started || !this.settled) throw new Error("TeamRuntime.next() requires the current round to be settled");
        if (!objective.trim()) throw new Error("Continuation objective must not be empty");
        return new TeamRuntime(objective, this.agents, {
            ...this.options,
            ...options
        }, this.teamId, requesterInitiated ? 1 : 0);
    }
    async close() {
        await Promise.allSettled([
            ...this.agents.values()
        ].map((agent)=>agent.close?.()));
    }
    progress() {
        return Object.freeze({
            teamId: this.teamId,
            active: Object.freeze([
                ...this.ready
            ]),
            finished: Object.freeze([
                ...this.finished.keys()
            ]),
            blocked: Object.freeze([
                ...this.blocked.keys()
            ]),
            blockedReasons: Object.freeze(Object.fromEntries(this.blocked)),
            states: Object.freeze(Object.fromEntries(this.states)),
            queuedMessages: [
                ...this.observations.values()
            ].reduce((sum, queue)=>sum + queue.length, 0),
            turns: this.totalTurns(),
            recent: this.recent
        });
    }
    intervene(memberId, message) {
        if (!this.started) throw new Error("TeamRuntime.intervene() may only be called while run() is executing");
        if (this.settled) throw new Error("the current team round has already settled; start a continuation round before intervening");
        if (!this.agents.has(memberId)) throw new Error(`Unknown member: ${memberId}`);
        if (this.finished.has(memberId) || this.errored.has(memberId)) throw new Error(`member ${memberId} is terminal (${this.states.get(memberId)}) and cannot be intervened`);
        if (!message.trim()) throw new Error("intervention message must not be empty");
        const wasBlocked = this.blocked.delete(memberId);
        this.userInterventions += 1;
        this.record("member.intervened", memberId, undefined, {
            unblocked: wasBlocked
        });
        this.post("user", {
            kind: "direct",
            memberId
        }, message, "interrupt", "message");
        this.resolveIntervention?.();
    }
    async awaitIntervention(signal) {
        return new Promise((resolve, reject)=>{
            const cleanup = ()=>{
                signal?.removeEventListener("abort", onAbort);
                if (this.resolveIntervention === onIntervene) this.resolveIntervention = undefined;
            };
            const onIntervene = ()=>{
                cleanup();
                resolve();
            };
            const onAbort = ()=>{
                cleanup();
                reject(signal?.reason ?? new Error("aborted"));
            };
            this.resolveIntervention = onIntervene;
            signal?.addEventListener("abort", onAbort, {
                once: true
            });
        });
    }
    async execute(initial, signal) {
        this.record("team.started", undefined, undefined, {
            objective: this.objective,
            memberCount: this.agents.size
        });
        const initialPosts = Array.isArray(initial) ? initial : [
            initial
        ];
        for (const post of initialPosts)this.post("user", post.channel, post.body, "interrupt", "message");
        if (initialPosts.length === 1) this.openingWaveMembers = new Set(this.ready);
        const maxTurns = this.options.maxTurns ?? Math.max(256, this.agents.size * 32);
        const waveConcurrency = Math.max(1, this.options.waveConcurrency ?? 8);
        let exhausted = false;
        while(!signal?.aborted){
            if (!this.ready.size && !this.promoteStarvedMembers()) {
                if (this.advanceOpenPollsAtQuiescence()) continue;
                if (this.blocked.size > 0 && this.options.waitForIntervention && maxTurns - this.totalTurns() > 0) {
                    this.emitActivity("runtime", "wait", `team quiescent — waiting for external intervention on blocked: ${[
                        ...this.blocked.keys()
                    ].join(", ")}`, {
                        kind: "public"
                    }, [
                        ...this.agents.keys()
                    ]);
                    this.recent = "waiting for external intervention";
                    await this.awaitIntervention(signal);
                    this.safeObserve("onProgress", ()=>this.options.onProgress?.(this.progress()));
                    continue;
                }
                break;
            }
            const remaining = maxTurns - this.totalTurns();
            if (remaining <= 0) {
                exhausted = true;
                break;
            }
            const rankSeed = `${this.teamId}:${this.totalTurns()}`;
            const fullWave = [
                ...this.ready
            ].sort((left, right)=>stableRank(rankSeed, left) - stableRank(rankSeed, right));
            const wave = fullWave.slice(0, remaining);
            const deferredByBudget = fullWave.slice(remaining);
            this.ready.clear();
            for (const id of deferredByBudget)this.ready.add(id);
            const waveCause = this.readyCause.get(wave[0]);
            const sameSource = wave.length > 1 && waveCause !== undefined && wave.every((id)=>this.readyCause.get(id) === waveCause);
            if (sameSource) {
                for (const id of wave)await this.wake(id, signal);
            } else {
                for(let start = 0; start < wave.length; start += waveConcurrency)await Promise.all(wave.slice(start, start + waveConcurrency).map((id)=>this.wake(id, signal)));
            }
            if (this.openingWaveMembers && [
                ...this.openingWaveMembers
            ].every((id)=>this.openingWaveDrafted.has(id) || !this.runnable(id))) {
                this.revealOpeningWaveDrafts();
                this.openingWaveMembers = null;
            }
            this.safeObserve("onProgress", ()=>this.options.onProgress?.(this.progress()));
        }
        if (signal?.aborted) throw signal.reason;
        this.settled = true;
        const settlement = this.finished.size === this.agents.size ? {
            kind: "completed",
            meaning: "all-members-finished"
        } : exhausted ? {
            kind: "exhausted",
            meaning: "max-turns-reached"
        } : this.finished.size + this.errored.size === this.agents.size ? {
            kind: "quiescent",
            meaning: "errored-members-remain"
        } : this.blocked.size === this.agents.size - this.finished.size - this.errored.size ? {
            kind: "quiescent",
            meaning: "blocked-members-remain"
        } : {
            kind: "quiescent",
            meaning: "no-runnable-members"
        };
        this.record(settlement.kind === "completed" ? "team.completed" : settlement.kind === "exhausted" ? "team.exhausted" : "team.quiescent", undefined, undefined, {
            finished: this.finished.size,
            errored: this.errored.size,
            blocked: this.blocked.size
        });
        const { report, reportError } = await this.collectReport(settlement, signal);
        return Object.freeze({
            teamId: this.teamId,
            settlement,
            objectiveVerification: "unverified",
            report,
            reportError,
            members: Object.freeze([
                ...this.agents.values()
            ].map((agent)=>Object.freeze({
                    id: agent.member.id,
                    sessionId: agent.sessionId,
                    sessionRef: agent.sessionRef,
                    turns: this.turns.get(agent.member.id) ?? 0,
                    state: this.states.get(agent.member.id) ?? "idle",
                    summary: this.finished.get(agent.member.id),
                    error: this.errored.get(agent.member.id),
                    blockedReason: this.blocked.get(agent.member.id)
                }))),
            publicTranscript: Object.freeze(this.envelopes.filter((envelope)=>envelope.channel.kind === "public").map(({ id, sequence, from, body })=>Object.freeze({
                    id,
                    sequence,
                    from,
                    body
                }))),
            restrictedMessages: Object.freeze(this.envelopes.filter((envelope)=>envelope.channel.kind !== "public").map((envelope)=>Object.freeze({
                    id: envelope.id,
                    sequence: envelope.sequence,
                    from: envelope.from,
                    channelKind: envelope.channel.kind,
                    audienceHash: sha256([
                        ...envelope.audience
                    ].sort().join("\0")),
                    bodyHash: sha256(envelope.body)
                }))),
            events: Object.freeze([
                ...this.events
            ]),
            userInterventions: this.userInterventions,
            auditHead: this.auditHead
        });
    }
    async collectReport(settlement, signal) {
        const reporterId = this.options.reporterId ?? this.claimedReporter;
        if (reporterId === undefined) return {};
        const agent = this.agents.get(reporterId);
        if (this.errored.has(reporterId)) return {
            reportError: `reporter ${reporterId} errored before reporting: ${this.errored.get(reporterId)}`
        };
        if (!agent.report) return {
            reportError: `reporter ${reporterId} does not support a report turn`
        };
        this.record("report.requested", reporterId, undefined, {
            designated: this.options.reporterId !== undefined,
            settlement: settlement.kind
        });
        const controller = new AbortController();
        const relayAbort = ()=>controller.abort(signal?.reason);
        signal?.addEventListener("abort", relayAbort, {
            once: true
        });
        const timeout = setTimeout(()=>controller.abort(new Error(`Reporter ${reporterId} timed out`)), this.options.actionTimeoutMs ?? 300_000);
        try {
            const body = await agent.report(this.reportTurnPrompt(settlement), controller.signal);
            this.record("report.submitted", reporterId, undefined, {
                bodyHash: sha256(body)
            });
            this.emitActivity(reporterId, "report", "final report", {
                kind: "public"
            }, [
                ...this.agents.keys()
            ], body);
            return {
                report: Object.freeze({
                    reporterId,
                    body
                })
            };
        } catch (cause) {
            if (signal?.aborted) throw cause;
            const message = cause instanceof Error ? cause.message : String(cause);
            this.record("report.failed", reporterId, undefined, {
                error: message
            });
            return {
                reportError: message
            };
        } finally{
            clearTimeout(timeout);
            signal?.removeEventListener("abort", relayAbort);
        }
    }
    reportTurnPrompt(settlement) {
        return [
            `TEAM SETTLED: ${settlement.kind} (${settlement.meaning}).`,
            "You are the team's reporter; this is one final turn after the whole team settled. Team coordination tools are inactive — write for the requester who started the team, not for your teammates.",
            this.options.reportPrompt ?? "Deliver the team's final report. Your response is returned verbatim to the requester as the team's result, so it must stand alone: state the outcome and everything the objective asked for. If your work produced files, reference their paths."
        ].join("\n");
    }
    promoteStarvedMembers() {
        let promoted = false;
        for (const [id, queue] of this.observations){
            if (!queue.length || !this.runnable(id) || this.flushing.has(id)) continue;
            this.ready.add(id);
            this.flushing.add(id);
            this.states.set(id, "ready");
            this.readyCause.delete(id);
            promoted = true;
        }
        return promoted;
    }
    runnable(memberId) {
        return !this.finished.has(memberId) && !this.errored.has(memberId) && !this.blocked.has(memberId);
    }
    deliverable(memberId) {
        return !this.finished.has(memberId) && !this.errored.has(memberId);
    }
    heldBackQueue(memberId) {
        let queue = this.heldBackForReveal.get(memberId);
        if (!queue) {
            queue = [];
            this.heldBackForReveal.set(memberId, queue);
        }
        return queue;
    }
    liftOpeningBarrierForInterrupt(memberId) {
        const held = this.heldBackForReveal.get(memberId);
        if (!held?.length) return;
        const queue = this.observations.get(memberId);
        queue.push(...held);
        queue.sort((left, right)=>left.sequence - right.sequence);
        this.heldBackForReveal.delete(memberId);
        this.openingWaveDrafted.add(memberId);
    }
    revealOpeningWaveDrafts() {
        for (const [memberId, envelopes] of this.heldBackForReveal){
            if (!envelopes.length || !this.deliverable(memberId)) continue;
            const queue = this.observations.get(memberId);
            queue.push(...envelopes);
            queue.sort((left, right)=>left.sequence - right.sequence);
            if (this.runnable(memberId)) {
                this.ready.add(memberId);
                this.states.set(memberId, "ready");
                this.readyCause.set(memberId, OPENING_WAVE_REVEAL_CAUSE);
            }
        }
        this.heldBackForReveal.clear();
    }
    async reactionDelay(signal) {
        const { min, max } = this.options.reactionDelayMs ?? {
            min: 0,
            max: 0
        };
        const ms = min + Math.random() * Math.max(0, max - min);
        if (ms <= 0) return;
        await new Promise((resolve, reject)=>{
            const onAbort = ()=>{
                clearTimeout(timer);
                reject(signal?.reason ?? new Error("aborted"));
            };
            const timer = setTimeout(()=>{
                signal?.removeEventListener("abort", onAbort);
                resolve();
            }, ms);
            signal?.addEventListener("abort", onAbort, {
                once: true
            });
        });
    }
    async wake(memberId, parentSignal) {
        if (this.openingWaveMembers?.has(memberId)) this.openingWaveDrafted.add(memberId);
        if (!this.runnable(memberId)) return;
        const flush = this.flushing.delete(memberId);
        const observations = this.observations.get(memberId).splice(0);
        if (!observations.length) return;
        try {
            await this.reactionDelay(parentSignal);
        } catch (cause) {
            if (parentSignal?.aborted) throw cause;
            this.markErrored(memberId, cause);
            return;
        }
        const agent = this.agents.get(memberId);
        const turn = (this.turns.get(memberId) ?? 0) + 1;
        this.turns.set(memberId, turn);
        this.states.set(memberId, "running");
        for (const message of observations)this.record("message.observed", memberId, message.id, {
            channelId: message.channel.id,
            bodyHash: sha256(message.body)
        });
        this.record(flush ? "member.flushWoke" : "member.woke", memberId, undefined, {
            turn,
            observationIds: observations.map((message)=>message.id),
            sessionId: agent.sessionId
        });
        this.emitActivity(memberId, "wake", `turn ${turn} · observed ${observations.length}${flush ? " (final flush)" : ""}`, {
            kind: "direct",
            memberId
        }, [
            memberId
        ]);
        const controller = new AbortController();
        const relayAbort = ()=>controller.abort(parentSignal?.reason);
        parentSignal?.addEventListener("abort", relayAbort, {
            once: true
        });
        const timeout = setTimeout(()=>controller.abort(new Error(`Agent ${memberId} timed out`)), this.options.actionTimeoutMs ?? 300_000);
        const abortRejection = new Promise((_, reject)=>{
            controller.signal.addEventListener("abort", ()=>reject(controller.signal.reason ?? new Error(`Agent ${memberId} aborted`)), {
                once: true
            });
        });
        abortRejection.catch(()=>{});
        try {
            const commands = await Promise.race([
                agent.act({
                    teamId: this.teamId,
                    objective: this.objective,
                    member: agent.member,
                    peers: Object.freeze([
                        ...this.agents.values()
                    ].map((value)=>value.member).filter((member)=>member.id !== memberId).sort((left, right)=>stableRank(`${this.teamId}:${memberId}`, left.id) - stableRank(`${this.teamId}:${memberId}`, right.id))),
                    observations: Object.freeze(observations),
                    digest: this.digestFor(memberId),
                    turn
                }, controller.signal),
                abortRejection
            ]);
            const claim = commands.find((command)=>command.type === "claim");
            if (claim) {
                this.applyCommand(memberId, claim);
                if (commands.length > 1) this.emitActivity(memberId, "wait", `claim fence discarded ${commands.length - 1} speculative action${commands.length === 2 ? "" : "s"}`, {
                    kind: "direct",
                    memberId
                }, [
                    memberId
                ]);
            } else {
                const terminalIndex = commands.findIndex((command)=>command.type === "wait" || command.type === "finish" || command.type === "block");
                const effective = terminalIndex === -1 ? commands : commands.slice(0, terminalIndex + 1);
                const budget = Math.max(1, this.options.maxCommandsPerTurn ?? 16);
                const applicable = effective.slice(0, budget);
                for(let index = 0; index < applicable.length; index++){
                    if (this.applyCommand(memberId, applicable[index])) continue;
                    const discarded = applicable.length - index - 1;
                    if (discarded > 0) this.post("runtime", {
                        kind: "direct",
                        memberId
                    }, `COMMAND_BATCH_HALTED rejected=${applicable[index].type} discarded=${discarded}; commands after a rejection are not applied — replan and resend what still matters next turn`, "interrupt", "system");
                    break;
                }
                if (effective.length > budget) this.post("runtime", {
                    kind: "direct",
                    memberId
                }, `COMMAND_BUDGET_EXCEEDED applied=${budget} dropped=${effective.length - budget}; resend what still matters next turn`, "interrupt", "system");
                const discardedAfterTurnEnd = commands.length - effective.length;
                if (discardedAfterTurnEnd > 0) this.emitActivity(memberId, "wait", `turn already ended by wait/block/finish; discarded ${discardedAfterTurnEnd} action${discardedAfterTurnEnd === 1 ? "" : "s"} queued after it`, {
                    kind: "direct",
                    memberId
                }, [
                    memberId
                ]);
            }
            if (this.runnable(memberId) && !this.ready.has(memberId)) this.states.set(memberId, "waiting");
        } catch (cause) {
            if (parentSignal?.aborted) throw cause;
            this.markErrored(memberId, cause);
        } finally{
            clearTimeout(timeout);
            parentSignal?.removeEventListener("abort", relayAbort);
        }
    }
    markErrored(memberId, cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        this.errored.set(memberId, message);
        this.states.set(memberId, "errored");
        this.ready.delete(memberId);
        this.record("member.errored", memberId, undefined, {
            error: message
        });
        this.emitActivity(memberId, "error", message, {
            kind: "direct",
            memberId
        }, [
            memberId
        ]);
        this.releaseClaims(memberId, "member-errored");
        this.recheckOpenPollsAfterTerminalTransition();
        this.post("runtime", {
            kind: "public"
        }, `MEMBER_ERRORED member=${memberId} error=${JSON.stringify(message)}. This member is out; route around it. Messages to it will bounce.`, "interrupt", "system");
    }
    applyCommand(from, command) {
        try {
            this.executeCommand(from, command);
            return true;
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            this.record("command.failed", from, undefined, {
                commandType: command.type,
                error: message
            });
            this.post("runtime", {
                kind: "direct",
                memberId: from
            }, `COMMAND_FAILED type=${command.type} error=${JSON.stringify(message)}`, "interrupt", "system");
            return false;
        }
    }
    executeCommand(from, command) {
        if (command.type === "wait") {
            this.emitActivity(from, "wait", "WAIT", {
                kind: "direct",
                memberId: from
            }, [
                from
            ]);
            return;
        }
        if (command.type === "block") {
            if (!command.reason.trim()) throw new Error("block reason must not be empty or whitespace-only");
            this.blocked.set(from, command.reason);
            this.states.set(from, "blocked");
            this.record("member.blocked", from, undefined, {
                reasonHash: sha256(command.reason)
            });
            this.emitActivity(from, "block", `blocked: ${command.reason}`, {
                kind: "direct",
                memberId: from
            }, [
                from
            ]);
            this.post("runtime", {
                kind: "public"
            }, `MEMBER_BLOCKED member=${from} reason=${JSON.stringify(command.reason)}. This member paused and is awaiting external intervention; route around it until it resumes.`, "passive", "system");
            return;
        }
        if (command.type === "finish") {
            this.finished.set(from, command.summary);
            this.states.set(from, "finished");
            this.record("member.finished", from, undefined, {
                summaryHash: sha256(command.summary)
            });
            this.emitActivity(from, "finish", command.summary, {
                kind: "direct",
                memberId: from
            }, [
                from
            ]);
            this.releaseClaims(from, "member-finished");
            this.recheckOpenPollsAfterTerminalTransition();
            return;
        }
        if (command.type === "claim") {
            this.claim(from, command.resource);
            return;
        }
        if (command.type === "release") {
            const owner = this.claims.get(command.resource);
            if (owner !== from) throw new Error(`cannot release ${command.resource}: ${owner ? `owned by ${owner}` : "not currently claimed"}`);
            this.releaseClaim(command.resource, from, "released-by-owner");
            return;
        }
        if (command.type === "create-group") {
            this.createGroup(from, command.channelId, command.name, command.members);
            return;
        }
        if (command.type === "vote-open") {
            this.openPoll(from, command);
            return;
        }
        if (command.type === "vote-cast") {
            this.castVote(from, command.pollId, command.choice);
            return;
        }
        if (command.type === "vote-abstain") {
            this.abstainVote(from, command.pollId);
            return;
        }
        if (command.type === "vote-close") {
            this.closePoll(from, command.pollId);
            return;
        }
        if (command.type === "say") {
            const mentions = [
                ...new Set((command.to ?? []).map((candidate)=>this.resolveMemberId(candidate)))
            ].filter((memberId)=>memberId !== from);
            for (const memberId of mentions)this.assertDeliverable(memberId);
            this.post(from, {
                kind: "public"
            }, command.body, "passive", "speech", mentions);
            return;
        }
        if (command.type === "broadcast") {
            this.post(from, {
                kind: "public"
            }, command.body, "interrupt", "speech");
            return;
        }
        if (command.type === "group-send") {
            this.post(from, {
                kind: "group",
                channelId: command.channelId
            }, command.body, "interrupt", "message");
            return;
        }
        const to = this.resolveMemberId(command.to);
        if (to === from) throw new Error(`cannot ${command.type} to yourself`);
        this.assertDeliverable(to);
        this.post(from, {
            kind: "direct",
            memberId: to
        }, command.body, "interrupt", command.type === "handoff" ? "handoff" : "message");
    }
    resolveMemberId(candidate) {
        if (this.agents.has(candidate)) return candidate;
        const matches = [
            ...this.agents.values()
        ].filter((agent)=>agent.member.name === candidate);
        if (matches.length === 1) return matches[0].member.id;
        if (matches.length > 1) throw new Error(`ambiguous recipient "${candidate}": multiple members share that name; use one of their ids instead (${matches.map((agent)=>agent.member.id).join(", ")})`);
        throw new Error(`unknown recipient "${candidate}"`);
    }
    assertDeliverable(to) {
        if (this.finished.has(to)) throw new Error(`recipient ${to} has finished and cannot be woken`);
        if (this.errored.has(to)) throw new Error(`recipient ${to} errored and cannot be woken`);
    }
    claim(from, resource) {
        const owner = this.claims.get(resource);
        if (!owner) {
            this.claims.set(resource, from);
            if (resource === REPORTER_RESOURCE) this.claimedReporter = from;
            this.record("member.claimed", from, undefined, {
                resource
            });
            this.emitActivity(from, "claim", `claimed ${resource}`, {
                kind: "direct",
                memberId: from
            }, [
                from
            ]);
            this.post("runtime", {
                kind: "direct",
                memberId: from
            }, `CLAIM_ACQUIRED resource=${JSON.stringify(resource)} owner=${from}`, "interrupt", "system");
            return;
        }
        if (owner !== from) {
            this.record("member.claimRejected", from, undefined, {
                resource,
                owner
            });
            this.emitActivity(from, "claim", `${resource} already claimed by ${owner}`, {
                kind: "direct",
                memberId: from
            }, [
                from
            ]);
        }
        this.post("runtime", {
            kind: "direct",
            memberId: from
        }, `${owner === from ? "CLAIM_ACQUIRED" : "CLAIM_REJECTED"} resource=${JSON.stringify(resource)} owner=${owner}`, "interrupt", "system");
    }
    releaseClaims(owner, reason) {
        for (const [resource, holder] of this.claims)if (holder === owner) this.releaseClaim(resource, owner, reason);
    }
    releaseClaim(resource, owner, reason) {
        this.claims.delete(resource);
        if (resource === REPORTER_RESOURCE && this.claimedReporter === owner && reason !== "member-finished") this.claimedReporter = undefined;
        this.record("claim.released", owner, undefined, {
            resource,
            reason
        });
        this.emitActivity(owner, "claim", `released ${resource}`, {
            kind: "direct",
            memberId: owner
        }, [
            owner
        ]);
        this.post("runtime", {
            kind: "public"
        }, `CLAIM_RELEASED resource=${JSON.stringify(resource)} former=${owner} reason=${reason}`, "passive", "system");
    }
    openPoll(from, command) {
        const { pollId, initiatorVotes, maxReminders, onReminderExhausted } = command;
        if (!pollId.trim()) throw new Error("poll id must not be empty");
        if (this.closedPolls.has(pollId)) throw new Error(`poll already closed: ${pollId}`);
        if (this.polls.has(pollId)) throw new Error(`poll already open: ${pollId}`);
        if (this.claims.get(pollId) !== from) throw new Error(`must hold claim ${pollId} before opening that poll`);
        if (typeof initiatorVotes !== "boolean") throw new Error("initiatorVotes must be boolean");
        if (!Number.isInteger(maxReminders) || maxReminders < 0 || maxReminders > 3) throw new Error("maxReminders must be an integer from 0 to 3");
        if (onReminderExhausted !== "leave-missing" && onReminderExhausted !== "abstain") throw new Error("onReminderExhausted must be leave-missing or abstain");
        const eligible = new Set([
            ...this.agents.keys()
        ].filter((memberId)=>initiatorVotes || memberId !== from));
        if (eligible.size === 0) throw new Error("poll must have at least one eligible voter");
        const poll = {
            explicit: true,
            initiator: from,
            initiatorVotes,
            maxReminders,
            onReminderExhausted,
            eligible,
            votes: new Map(),
            abstained: new Set(),
            autoAbstained: new Set(),
            reminders: new Map()
        };
        this.polls.set(pollId, poll);
        this.record("poll.opened", from, undefined, {
            pollId,
            initiatorVotes,
            maxReminders,
            onReminderExhausted,
            eligible: [
                ...eligible
            ]
        });
        this.emitActivity(from, "vote", `opened ${pollId}`, {
            kind: "public"
        }, [
            ...eligible
        ]);
        this.post("runtime", {
            kind: "public"
        }, `POLL_OPENED pollId=${JSON.stringify(pollId)} initiator=${from} eligible=${JSON.stringify([
            ...eligible
        ])} maxReminders=${maxReminders} onReminderExhausted=${onReminderExhausted}`, "passive", "system");
    }
    castVote(from, pollId, choice) {
        if (!choice.trim()) throw new Error("vote choice must not be empty");
        const poll = this.requireOpenPollForResponse(from, pollId);
        poll.abstained.delete(from);
        poll.autoAbstained.delete(from);
        poll.votes.set(from, choice);
        this.record("poll.cast", from, undefined, {
            pollId,
            choice
        });
        this.emitActivity(from, "vote", `voted on ${pollId}`, {
            kind: "direct",
            memberId: from
        }, [
            from
        ]);
        this.maybeAnnouncePollReady(pollId, poll);
    }
    abstainVote(from, pollId) {
        const poll = this.requireOpenPollForResponse(from, pollId);
        poll.votes.delete(from);
        poll.autoAbstained.delete(from);
        poll.abstained.add(from);
        this.record("poll.abstained", from, undefined, {
            pollId,
            automatic: false
        });
        this.emitActivity(from, "vote", `abstained on ${pollId}`, {
            kind: "direct",
            memberId: from
        }, [
            from
        ]);
        this.maybeAnnouncePollReady(pollId, poll);
    }
    requireOpenPollForResponse(from, pollId) {
        if (this.closedPolls.has(pollId)) throw new Error(`poll already closed: ${pollId}`);
        let poll = this.polls.get(pollId);
        if (!poll) {
            if (!this.claims.has(pollId)) throw new Error(`must claim ${pollId} before opening a new poll with that id`);
            poll = {
                explicit: false,
                initiator: this.claims.get(pollId),
                initiatorVotes: true,
                maxReminders: 0,
                onReminderExhausted: "leave-missing",
                eligible: new Set(this.agents.keys()),
                votes: new Map(),
                abstained: new Set(),
                autoAbstained: new Set(),
                reminders: new Map()
            };
            this.polls.set(pollId, poll);
        }
        if (!poll.eligible.has(from)) throw new Error(`member ${from} is not eligible to respond to poll ${pollId}`);
        return poll;
    }
    maybeAnnouncePollReady(pollId, poll) {
        if (this.readyPolls.has(pollId) || poll.votes.size + poll.abstained.size === 0) return;
        const result = this.tallyPoll(pollId, poll);
        if (result.missing.length !== 0) return;
        this.readyPolls.add(pollId);
        const details = `pollId=${JSON.stringify(pollId)} voters=${JSON.stringify(Object.keys(result.votes))} abstained=${JSON.stringify(result.abstained)} autoAbstained=${JSON.stringify(result.autoAbstained)}`;
        if (poll.explicit && this.deliverable(poll.initiator)) this.post("runtime", {
            kind: "direct",
            memberId: poll.initiator
        }, `POLL_READY_TO_CLOSE ${details}; call team_vote_close`, "interrupt", "system");
        else this.post("runtime", {
            kind: "public"
        }, `POLL_FULLY_CAST ${details}`, "interrupt", "system");
    }
    recheckOpenPollsAfterTerminalTransition() {
        for (const [pollId, poll] of this.polls)this.maybeAnnouncePollReady(pollId, poll);
    }
    advanceOpenPollsAtQuiescence() {
        let changed = false;
        for (const [pollId, poll] of this.polls){
            if (!poll.explicit || this.readyPolls.has(pollId)) continue;
            const missing = this.tallyPoll(pollId, poll).missing;
            for (const memberId of missing){
                if (!this.deliverable(memberId) || this.blocked.has(memberId)) continue;
                const reminders = poll.reminders.get(memberId) ?? 0;
                if (reminders < poll.maxReminders) {
                    const next = reminders + 1;
                    poll.reminders.set(memberId, next);
                    this.record("poll.reminded", memberId, undefined, {
                        pollId,
                        attempt: next
                    });
                    this.post("runtime", {
                        kind: "direct",
                        memberId
                    }, `POLL_REMINDER pollId=${JSON.stringify(pollId)} attempt=${next}/${poll.maxReminders}; call team_vote_cast or team_vote_abstain`, "interrupt", "system");
                    changed = true;
                } else if (poll.onReminderExhausted === "abstain") {
                    poll.abstained.add(memberId);
                    poll.autoAbstained.add(memberId);
                    this.record("poll.abstained", memberId, undefined, {
                        pollId,
                        automatic: true
                    });
                    this.emitActivity("runtime", "vote", `${memberId} auto-abstained on ${pollId} after ${poll.maxReminders} reminder${poll.maxReminders === 1 ? "" : "s"}`, {
                        kind: "direct",
                        memberId
                    }, [
                        memberId
                    ]);
                    changed = true;
                }
            }
            this.maybeAnnouncePollReady(pollId, poll);
        }
        return changed || this.ready.size > 0;
    }
    closePoll(from, pollId) {
        const existing = this.closedPolls.get(pollId);
        if (existing) throw new Error(`poll already closed: ${pollId} — ${describePollOutcome(existing.outcome)}`);
        const poll = this.polls.get(pollId);
        if (!poll) throw new Error(`no such poll: ${pollId}`);
        if (poll.votes.size + poll.abstained.size === 0) throw new Error(`poll ${pollId} has no responses and cannot be closed`);
        const result = this.tallyPoll(pollId, poll);
        this.closedPolls.set(pollId, result);
        this.polls.delete(pollId);
        this.readyPolls.delete(pollId);
        this.record("poll.closed", from, undefined, {
            pollId,
            tally: result.tally,
            abstained: result.abstained,
            autoAbstained: result.autoAbstained,
            missing: result.missing,
            outcome: result.outcome
        });
        this.emitActivity(from, "vote", `closed ${pollId}: ${describePollOutcome(result.outcome)}`, {
            kind: "public"
        }, [
            ...this.agents.keys()
        ]);
        this.post("runtime", {
            kind: "public"
        }, `POLL_CLOSED pollId=${JSON.stringify(pollId)} tally=${JSON.stringify(result.tally)} abstained=${JSON.stringify(result.abstained)} autoAbstained=${JSON.stringify(result.autoAbstained)} missing=${JSON.stringify(result.missing)} outcome=${JSON.stringify(result.outcome)}`, "interrupt", "system");
    }
    tallyPoll(pollId, poll) {
        const tally = {};
        for (const choice of poll.votes.values())tally[choice] = (tally[choice] ?? 0) + 1;
        const responded = new Set([
            ...poll.votes.keys(),
            ...poll.abstained
        ]);
        const eligible = [
            ...poll.eligible
        ].filter((id)=>responded.has(id) || this.deliverable(id));
        const missing = eligible.filter((id)=>!responded.has(id));
        const entries = Object.entries(tally);
        const outcome = !entries.length ? {
            kind: "no-votes"
        } : (()=>{
            const max = Math.max(...entries.map(([, count])=>count));
            const winners = entries.filter(([, count])=>count === max).map(([choice])=>choice);
            return winners.length === 1 ? {
                kind: "winner",
                choice: winners[0]
            } : {
                kind: "tie",
                choices: Object.freeze(winners)
            };
        })();
        return Object.freeze({
            pollId,
            tally: Object.freeze(tally),
            votes: Object.freeze(Object.fromEntries(poll.votes)),
            abstained: Object.freeze([
                ...poll.abstained
            ]),
            autoAbstained: Object.freeze([
                ...poll.autoAbstained
            ]),
            eligible: Object.freeze(eligible),
            missing: Object.freeze(missing),
            outcome
        });
    }
    createGroup(creator, channelId, name, requestedMembers) {
        if (this.groups.has(channelId)) throw new Error(`Group already exists: ${channelId}`);
        const holder = this.claims.get(channelId);
        if (holder !== undefined && holder !== creator) throw new Error(`cannot create group ${channelId}: its id is claimed by ${holder}`);
        const resolvedMembers = requestedMembers.map((candidate)=>this.resolveMemberId(candidate));
        if (holder === undefined) {
            this.claims.set(channelId, creator);
            if (channelId === REPORTER_RESOURCE) this.claimedReporter = creator;
            this.record("member.claimed", creator, undefined, {
                resource: channelId
            });
        }
        const members = Object.freeze([
            ...new Set([
                creator,
                ...resolvedMembers
            ])
        ]);
        const group = Object.freeze({
            kind: "group",
            id: channelId,
            name,
            members
        });
        this.groups.set(channelId, group);
        this.record("channel.created", creator, undefined, {
            channelId,
            audienceHash: sha256([
                ...members
            ].sort().join("\0"))
        });
        this.emitActivity(creator, "channel", `created group ${name}`, {
            kind: "group",
            channelId
        }, members);
    }
    post(from, target, body, wake, purpose, mentions = []) {
        const { channel, audience } = this.resolveChannel(from, target);
        const envelope = Object.freeze({
            id: randomUUID(),
            sequence: this.envelopes.length + 1,
            from,
            channel,
            audience: Object.freeze(audience),
            body,
            wake,
            mentions: Object.freeze([
                ...mentions
            ]),
            purpose,
            sentAt: Date.now()
        });
        this.envelopes.push(envelope);
        this.record("message.posted", from === "user" || from === "runtime" ? undefined : from, envelope.id, {
            channelKind: channel.kind,
            channelId: channel.id,
            purpose,
            wake,
            audienceHash: sha256([
                ...audience
            ].sort().join("\0")),
            bodyHash: sha256(body)
        });
        this.emitActivity(from, "message", body, target, audience, body, envelope.mentions);
        for (const recipient of audience){
            if (recipient === from || !this.deliverable(recipient)) continue;
            const interrupts = !this.blocked.has(recipient) && (wake === "interrupt" || envelope.mentions.includes(recipient));
            if (interrupts) {
                this.liftOpeningBarrierForInterrupt(recipient);
            }
            const holdBackForReveal = !interrupts && wake === "passive" && channel.kind === "public" && this.openingWaveMembers?.has(recipient) === true && !this.openingWaveDrafted.has(recipient);
            (holdBackForReveal ? this.heldBackQueue(recipient) : this.observations.get(recipient)).push(envelope);
            if (interrupts) this.observations.get(recipient).sort((left, right)=>left.sequence - right.sequence);
            this.record("message.enqueued", recipient, envelope.id, {
                channelId: channel.id,
                bodyHash: sha256(body)
            });
            if (interrupts) {
                this.ready.add(recipient);
                this.states.set(recipient, "ready");
                this.readyCause.set(recipient, envelope.id);
            }
        }
        this.recent = `${from} → ${channel.id}`;
    }
    digestFor(memberId) {
        return Object.freeze({
            states: Object.freeze(Object.fromEntries(this.states)),
            blockedReasons: Object.freeze(Object.fromEntries(this.blocked)),
            claims: Object.freeze(Object.fromEntries(this.claims)),
            groups: Object.freeze([
                ...this.groups.values()
            ].filter((group)=>group.members.includes(memberId)).map((group)=>Object.freeze({
                    id: group.id,
                    name: group.name,
                    members: group.members
                }))),
            polls: Object.freeze([
                ...this.polls.entries()
            ].map(([pollId, poll])=>{
                const result = this.tallyPoll(pollId, poll);
                return Object.freeze({
                    pollId,
                    initiator: poll.initiator,
                    tally: result.tally,
                    abstained: result.abstained,
                    autoAbstained: result.autoAbstained,
                    missing: result.missing
                });
            }))
        });
    }
    resolveChannel(from, target) {
        if (target.kind === "public") return {
            channel: Object.freeze({
                kind: "public",
                id: "public"
            }),
            audience: [
                ...this.agents.keys()
            ]
        };
        if (target.kind === "direct") {
            if (!this.agents.has(target.memberId)) throw new Error(`Unknown recipient: ${target.memberId}`);
            return {
                channel: Object.freeze({
                    kind: "direct",
                    id: directChannelId(from, target.memberId),
                    members: Object.freeze([
                        from,
                        target.memberId
                    ])
                }),
                audience: [
                    target.memberId
                ]
            };
        }
        const group = this.groups.get(target.channelId);
        if (!group) throw new Error(`Unknown group: ${target.channelId}`);
        if (from !== "runtime" && from !== "user" && !group.members.includes(from)) throw new Error(`Member ${from} cannot post to group ${target.channelId}`);
        return {
            channel: group,
            audience: [
                ...group.members
            ]
        };
    }
    record(type, memberId, messageId, data = {}) {
        const sequence = this.events.length + 1;
        const payload = JSON.stringify({
            sequence,
            type,
            memberId,
            messageId,
            data,
            previousHash: this.auditHead
        });
        const hash = sha256(payload);
        this.events.push(Object.freeze({
            sequence,
            type,
            memberId,
            messageId,
            data: Object.freeze(data),
            previousHash: this.auditHead,
            hash
        }));
        this.auditHead = hash;
    }
    safeObserve(observer, invoke) {
        if (this.disabledObservers.has(observer)) return;
        try {
            invoke();
        } catch (cause) {
            this.disabledObservers.add(observer);
            this.record("observer.failed", undefined, undefined, {
                observer,
                error: cause instanceof Error ? cause.message : String(cause)
            });
        }
    }
    emitActivity(memberId, kind, text, channel, targetIds, body, mentions) {
        this.safeObserve("onActivity", ()=>this.options.onActivity?.(Object.freeze({
                sequence: ++this.activitySequence,
                memberId,
                kind,
                text,
                visibility: channel.kind !== "public" ? "restricted" : "public",
                channel,
                targetIds: Object.freeze([
                    ...targetIds
                ]),
                mentions: mentions?.length ? Object.freeze([
                    ...mentions
                ]) : undefined,
                body
            })));
    }
    totalTurns() {
        return [
            ...this.turns.values()
        ].reduce((sum, count)=>sum + count, 0);
    }
}
const OPENING_WAVE_REVEAL_CAUSE = "reveal:opening-wave";
function describePollOutcome(outcome) {
    if (outcome.kind === "winner") return `winner=${outcome.choice}`;
    if (outcome.kind === "tie") return `tie=${outcome.choices.join(",")}`;
    return "no votes";
}
function directChannelId(from, to) {
    return `direct:${[
        from,
        to
    ].sort().join(":")}`;
}
function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
function stableRank(seed, memberId) {
    return Number.parseInt(sha256(`${seed}:${memberId}`).slice(0, 12), 16);
}
export function verifyAudit(events) {
    let previousHash = "0".repeat(64);
    for(let index = 0; index < events.length; index++){
        const event = events[index];
        if (event.sequence !== index + 1 || event.previousHash !== previousHash) return false;
        const payload = JSON.stringify({
            sequence: event.sequence,
            type: event.type,
            memberId: event.memberId,
            messageId: event.messageId,
            data: event.data,
            previousHash: event.previousHash
        });
        if (sha256(payload) !== event.hash) return false;
        previousHash = event.hash;
    }
    return true;
}
