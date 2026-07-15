# Found Hermes isolation

Found runs the Hermes Slack gateway inside Docker using a dedicated
`foundcontainer` profile. The container receives only:

- Hermes-owned configuration and sessions from
  `~/.hermes/profiles/foundcontainer`;
- Found's `AGENTS.md` and `CV1.md` policies, read-only;
- the indexed demo knowledge under `data/`, read-only.

The container does not mount the user's Desktop, Documents, Downloads, SSH
configuration, Git credentials, browser data, or the rest of the Found source
repository. Model-emitted terminal commands execute inside this container. The
host Docker socket is deliberately not mounted, and no host environment
variables are forwarded.

## Start safely

Keep the host `launchd` gateway stopped, then run:

```bash
hermes profile create foundcontainer --clone --no-alias
hermes -p foundcontainer config set terminal.backend local
hermes -p foundcontainer config set terminal.cwd /knowledge
hermes -p foundcontainer config set terminal.home_mode profile
docker compose -f docker-compose.hermes.yml pull
docker compose -f docker-compose.hermes.yml up -d
docker compose -f docker-compose.hermes.yml logs --tail 50 gateway
```

## Stop

```bash
docker compose -f docker-compose.hermes.yml down
```

## Verify mounts

```bash
docker inspect found-hermes-gateway \
  --format '{{range .Mounts}}{{println .Source "->" .Destination .Mode}}{{end}}'
```

Only `/opt/data`, `/knowledge/AGENTS.md`, `/knowledge/CV1.md`, and
`/knowledge/data` should appear.
