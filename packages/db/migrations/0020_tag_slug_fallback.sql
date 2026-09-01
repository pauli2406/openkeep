-- Tags whose name slugify cannot transliterate (CJK, emoji) used to be stored
-- with an empty slug. The unique index on slug meant only one such tag could
-- exist and every later one collided (#283). tagSlug() in the API now falls
-- back to `tag-` + the first 16 hex chars of sha256 over the normalized name
-- (trimmed, lower-cased, whitespace runs collapsed to one space). Rewrite the
-- stored row the same way so the processing pipeline resolves it instead of
-- creating a duplicate next to it.
UPDATE "tags"
SET "slug" = 'tag-' || left(
	encode(
		sha256(
			convert_to(
				lower(regexp_replace(regexp_replace("name", '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')),
				'UTF8'
			)
		),
		'hex'
	),
	16
)
WHERE "slug" = '';
