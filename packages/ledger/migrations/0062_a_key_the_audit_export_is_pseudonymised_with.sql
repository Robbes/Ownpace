-- 0062: a key the audit export is pseudonymised with (workplan 0129 T4; the
-- owner's D4: "Email addresses and file names replaced by pseudonyms in the
-- export by default").
--
-- A pseudonym is a keyed hash: within one deployment the same address is
-- always the same pseudonym, so the lines a collector keeps can still be joined
-- on who did what, and the export names nobody. The key must outlive a
-- restart, or every restart would change every pseudonym and break exactly that
-- join. The appliance has no secret of its own to derive one from, so the key
-- is kept here, made the first time the export asks for it (`deploymentKeyFor`).
--
-- One row per purpose, hex text so both drivers read it alike. Nothing
-- tenant-scoped reads it: the export reads it as the owner, and the request
-- path has no privilege on it at all.

CREATE TABLE public.deployment_key (
    purpose text NOT NULL PRIMARY KEY
        CONSTRAINT deployment_key_purpose CHECK (purpose ~ '^[a-z][a-z0-9-]{0,63}$'),
    key text NOT NULL
        CONSTRAINT deployment_key_key CHECK (key ~ '^[0-9a-f]{64}$'),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- The schema's default privileges would otherwise give the request path all four.
REVOKE ALL ON TABLE public.deployment_key FROM app_user;
