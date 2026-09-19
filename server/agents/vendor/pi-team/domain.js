// Generated from pi-agent-team 0.3.0; see NOTICE.md.
export function assertValidMemberId(id) {
    if (!id.trim()) throw new Error("Member id must not be empty or whitespace-only");
    if (id === "user" || id === "runtime") throw new Error(`Member id "${id}" collides with a reserved principal id; choose a different id`);
}
