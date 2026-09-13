It's working, few things are not what I wanted:

1. [X] The list of allowed peer should not be saved to config.json, it should be tied to session by session (via session-id), I suggest to save them in project dir under `.pi/<session-id>/peers.json`
3. [x] Change the tool name to `session_communicate` isntead of `session_ask` 
2. [ ] Change the peer sub-command name "block" to "drop"
4. [ ] Disable the peerReplyHint (eg; `Reply with session_ask({ to_session_id: "01a09a39-40c5-73f2-9083-e34b71f4be9a", text: "…", in_reply_to: "m-907eb229ecdf" }) (or /peer allow first if that session is not in your allowlist).`)