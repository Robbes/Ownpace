// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The directory of a `stat` that answers seed_docker_socket_gid's one question
 * (deploy/compose/env-read.sh) as a socket of group 988, and hands every other
 * call to the real stat: `scripts/fixtures/docker-socket/stat`. The unit tests
 * that run ensure-env-secrets.sh or bootstrap-managed.sh put it first on the
 * script's PATH, so they do not depend on whether the machine running them has
 * a Docker socket (workplan 0119, 2026-11-20).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DOCKER_SOCKET_STAT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'docker-socket');
/** The group the stand-in reads for /var/run/docker.sock. */
export const DOCKER_SOCKET_STUB_GID = '988';
