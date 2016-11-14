-- Table: public.app_user

-- DROP TABLE public.app_user;

CREATE TABLE public.app_user
(
    id integer NOT NULL DEFAULT nextval('app_user_id_seq'::regclass),
    username text COLLATE pg_catalog."default" NOT NULL,
    passwordhash text COLLATE pg_catalog."default" NOT NULL,
    CONSTRAINT app_user_pkey PRIMARY KEY (id),
    CONSTRAINT app_user_username_key UNIQUE (username)
)
WITH (
    OIDS = FALSE
)
TABLESPACE pg_default;

ALTER TABLE public.app_user
    OWNER to postgres;

GRANT SELECT, UPDATE ON TABLE public.app_user TO anagram_reviewer_app;

GRANT ALL ON TABLE public.app_user TO postgres;
