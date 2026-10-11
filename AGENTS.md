# Contributor instructions

- Use HTTP/API/CLI and local tests for verification. Never make a live SNS post as a test without explicit authorization.
- Keep secrets in the runtime secret store; do not log tokens or upstream error bodies.
- Preserve ownership and posting history. Archive rather than delete.
- An uncertain publication must require review, never an automatic retry.
- Run npm run check and python3 -m unittest discover -s test -p 'test_*.py'.
- Before deployment inspect the target account, database schema and run wrangler deploy --dry-run.
