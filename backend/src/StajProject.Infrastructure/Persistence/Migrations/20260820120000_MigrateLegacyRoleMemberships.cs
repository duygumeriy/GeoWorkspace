using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// Legacy Admin/User üyeliklerini kanonik Administrator/GIS Editor üyeliklerine
/// tek seferlik ve geri alınabilir biçimde taşır.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260820120000_MigrateLegacyRoleMemberships")]
public partial class MigrateLegacyRoleMemberships : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            CREATE TABLE IF NOT EXISTS phase10c_legacy_membership_markers
            (
                user_id integer NOT NULL,
                source_role_id integer NOT NULL,
                destination_role_id integer NOT NULL,
                destination_membership_preexisting boolean NOT NULL,
                CONSTRAINT pk_phase10c_legacy_membership_markers
                    PRIMARY KEY (user_id, source_role_id, destination_role_id)
            );

            CREATE TABLE IF NOT EXISTS phase10c_geographic_scope_markers
            (
                created_id integer PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS phase10c_role_claim_markers
            (
                created_id integer PRIMARY KEY
            );
            """);

        // Fail before changing memberships if role resolution is ambiguous, a
        // required destination is absent, or role-permission sets have diverged.
        migrationBuilder.Sql(
            """
            DO $phase10c$
            DECLARE
                mapping record;
                source_ids integer[];
                destination_ids integer[];
                source_id integer;
                destination_id integer;
            BEGIN
                FOR mapping IN
                    SELECT * FROM (VALUES
                        ('ADMIN', 'ADMINISTRATOR'),
                        ('USER', 'GIS EDITOR')
                    ) AS mappings(source_normalized_name, destination_normalized_name)
                LOOP
                    SELECT array_agg(r."Id" ORDER BY r."Id")
                    INTO source_ids
                    FROM roles r
                    WHERE upper(btrim(r."NormalizedName")) = mapping.source_normalized_name
                       OR upper(btrim(r."Name")) = mapping.source_normalized_name;

                    SELECT array_agg(r."Id" ORDER BY r."Id")
                    INTO destination_ids
                    FROM roles r
                    WHERE upper(btrim(r."NormalizedName")) = mapping.destination_normalized_name
                       OR upper(btrim(r."Name")) = mapping.destination_normalized_name;

                    IF cardinality(source_ids) > 1 OR cardinality(destination_ids) > 1 THEN
                        RAISE EXCEPTION
                            'Phase 10C-C: ambiguous role resolution for % -> %',
                            mapping.source_normalized_name,
                            mapping.destination_normalized_name;
                    END IF;

                    source_id := source_ids[1];
                    destination_id := destination_ids[1];

                    IF source_id IS NOT NULL
                       AND EXISTS (SELECT 1 FROM user_roles ur WHERE ur."RoleId" = source_id)
                    THEN
                        IF destination_id IS NULL THEN
                            RAISE EXCEPTION
                                'Phase 10C-C: source role % has memberships but destination role % is missing',
                                mapping.source_normalized_name,
                                mapping.destination_normalized_name;
                        END IF;

                        IF EXISTS (
                            SELECT rp.permission_id
                            FROM role_permissions rp
                            WHERE rp.role_id = source_id
                            EXCEPT
                            SELECT rp.permission_id
                            FROM role_permissions rp
                            WHERE rp.role_id = destination_id
                        ) OR EXISTS (
                            SELECT rp.permission_id
                            FROM role_permissions rp
                            WHERE rp.role_id = destination_id
                            EXCEPT
                            SELECT rp.permission_id
                            FROM role_permissions rp
                            WHERE rp.role_id = source_id
                        ) THEN
                            RAISE EXCEPTION
                                'Phase 10C-C: role-permission sets differ for % -> %; memberships were not changed',
                                mapping.source_normalized_name,
                                mapping.destination_normalized_name;
                        END IF;
                    END IF;
                END LOOP;
            END
            $phase10c$;
            """);

        // Record original membership state before inserting any canonical row.
        migrationBuilder.Sql(
            """
            WITH mappings(source_normalized_name, destination_normalized_name) AS
            (
                VALUES ('ADMIN', 'ADMINISTRATOR'), ('USER', 'GIS EDITOR')
            ),
            role_pairs AS
            (
                SELECT source."Id" AS source_role_id,
                       destination."Id" AS destination_role_id
                FROM mappings m
                JOIN roles source
                  ON upper(btrim(source."NormalizedName")) = m.source_normalized_name
                  OR upper(btrim(source."Name")) = m.source_normalized_name
                JOIN roles destination
                  ON upper(btrim(destination."NormalizedName")) = m.destination_normalized_name
                  OR upper(btrim(destination."Name")) = m.destination_normalized_name
            )
            INSERT INTO phase10c_legacy_membership_markers
                (user_id, source_role_id, destination_role_id, destination_membership_preexisting)
            SELECT source_membership."UserId",
                   pair.source_role_id,
                   pair.destination_role_id,
                   EXISTS
                   (
                       SELECT 1
                       FROM user_roles destination_membership
                       WHERE destination_membership."UserId" = source_membership."UserId"
                         AND destination_membership."RoleId" = pair.destination_role_id
                   )
            FROM role_pairs pair
            JOIN user_roles source_membership
              ON source_membership."RoleId" = pair.source_role_id
            ON CONFLICT (user_id, source_role_id, destination_role_id) DO NOTHING;
            """);

        // Preserve equivalent role-scoped geographic authorization. Source rows
        // remain untouched; only genuinely missing canonical equivalents are copied.
        migrationBuilder.Sql(
            """
            WITH mappings(source_normalized_name, destination_normalized_name) AS
            (
                VALUES ('ADMIN', 'ADMINISTRATOR'), ('USER', 'GIS EDITOR')
            ),
            role_pairs AS
            (
                SELECT source."Id" AS source_role_id,
                       destination."Id" AS destination_role_id
                FROM mappings m
                JOIN roles source
                  ON upper(btrim(source."NormalizedName")) = m.source_normalized_name
                  OR upper(btrim(source."Name")) = m.source_normalized_name
                JOIN roles destination
                  ON upper(btrim(destination."NormalizedName")) = m.destination_normalized_name
                  OR upper(btrim(destination."Name")) = m.destination_normalized_name
            ),
            candidates AS
            (
                SELECT scope.*,
                       pair.destination_role_id,
                       row_number() OVER
                       (
                           PARTITION BY pair.destination_role_id,
                                        scope.name,
                                        scope.source_type,
                                        scope.source_key,
                                        ST_AsEWKB(ST_Normalize(scope.area))
                           ORDER BY scope."Id"
                       ) AS candidate_number
                FROM role_pairs pair
                JOIN geographic_authorizations scope
                  ON scope.role_id = pair.source_role_id
                WHERE EXISTS
                (
                    SELECT 1
                    FROM phase10c_legacy_membership_markers marker
                    WHERE marker.source_role_id = pair.source_role_id
                )
            ),
            inserted AS
            (
                INSERT INTO geographic_authorizations
                    (user_id, role_id, name, source_type, source_key, area, created_date, modified_date)
                SELECT NULL,
                       candidate.destination_role_id,
                       candidate.name,
                       candidate.source_type,
                       candidate.source_key,
                       candidate.area,
                       candidate.created_date,
                       candidate.modified_date
                FROM candidates candidate
                WHERE candidate.candidate_number = 1
                  AND NOT EXISTS
                  (
                      SELECT 1
                      FROM geographic_authorizations existing
                      WHERE existing.role_id = candidate.destination_role_id
                        AND existing.name = candidate.name
                        AND existing.source_type = candidate.source_type
                        AND existing.source_key IS NOT DISTINCT FROM candidate.source_key
                        AND ST_Equals(existing.area, candidate.area)
                  )
                RETURNING "Id"
            )
            INSERT INTO phase10c_geographic_scope_markers (created_id)
            SELECT "Id" FROM inserted
            ON CONFLICT (created_id) DO NOTHING;
            """);

        // Identity role claims are additive. Copy only missing claim type/value
        // pairs and retain source claims for transitional compatibility.
        migrationBuilder.Sql(
            """
            WITH mappings(source_normalized_name, destination_normalized_name) AS
            (
                VALUES ('ADMIN', 'ADMINISTRATOR'), ('USER', 'GIS EDITOR')
            ),
            role_pairs AS
            (
                SELECT source."Id" AS source_role_id,
                       destination."Id" AS destination_role_id
                FROM mappings m
                JOIN roles source
                  ON upper(btrim(source."NormalizedName")) = m.source_normalized_name
                  OR upper(btrim(source."Name")) = m.source_normalized_name
                JOIN roles destination
                  ON upper(btrim(destination."NormalizedName")) = m.destination_normalized_name
                  OR upper(btrim(destination."Name")) = m.destination_normalized_name
            ),
            candidates AS
            (
                SELECT DISTINCT pair.destination_role_id,
                                claim."ClaimType",
                                claim."ClaimValue"
                FROM role_pairs pair
                JOIN role_claims claim ON claim."RoleId" = pair.source_role_id
                WHERE EXISTS
                (
                    SELECT 1
                    FROM phase10c_legacy_membership_markers marker
                    WHERE marker.source_role_id = pair.source_role_id
                )
            ),
            inserted AS
            (
                INSERT INTO role_claims ("RoleId", "ClaimType", "ClaimValue")
                SELECT candidate.destination_role_id,
                       candidate."ClaimType",
                       candidate."ClaimValue"
                FROM candidates candidate
                WHERE NOT EXISTS
                (
                    SELECT 1
                    FROM role_claims existing
                    WHERE existing."RoleId" = candidate.destination_role_id
                      AND existing."ClaimType" IS NOT DISTINCT FROM candidate."ClaimType"
                      AND existing."ClaimValue" IS NOT DISTINCT FROM candidate."ClaimValue"
                )
                RETURNING "Id"
            )
            INSERT INTO phase10c_role_claim_markers (created_id)
            SELECT "Id" FROM inserted
            ON CONFLICT (created_id) DO NOTHING;
            """);

        // Destination insertion precedes source deletion. ON CONFLICT handles
        // users that already have the canonical membership.
        migrationBuilder.Sql(
            """
            INSERT INTO user_roles ("UserId", "RoleId")
            SELECT marker.user_id, marker.destination_role_id
            FROM phase10c_legacy_membership_markers marker
            ON CONFLICT ("UserId", "RoleId") DO NOTHING;

            DELETE FROM user_roles source_membership
            USING phase10c_legacy_membership_markers marker
            WHERE source_membership."UserId" = marker.user_id
              AND source_membership."RoleId" = marker.source_role_id
              AND EXISTS
              (
                  SELECT 1
                  FROM user_roles destination_membership
                  WHERE destination_membership."UserId" = marker.user_id
                    AND destination_membership."RoleId" = marker.destination_role_id
              );
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // A missing legacy role makes a safe rollback impossible. Fail before
        // removing any canonical membership or migration-created scope/claim.
        migrationBuilder.Sql(
            """
            DO $phase10c_down$
            BEGIN
                IF EXISTS
                (
                    SELECT 1
                    FROM phase10c_legacy_membership_markers marker
                    LEFT JOIN roles source ON source."Id" = marker.source_role_id
                    WHERE source."Id" IS NULL
                ) THEN
                    RAISE EXCEPTION
                        'Phase 10C-C rollback: a legacy source role is missing; rollback made no changes';
                END IF;
            END
            $phase10c_down$;
            """);

        // Restore every source membership recorded by Up. Physical user deletes
        // are tolerated; no membership can or should be restored for such users.
        migrationBuilder.Sql(
            """
            INSERT INTO user_roles ("UserId", "RoleId")
            SELECT marker.user_id, marker.source_role_id
            FROM phase10c_legacy_membership_markers marker
            JOIN users existing_user ON existing_user."Id" = marker.user_id
            ON CONFLICT ("UserId", "RoleId") DO NOTHING;

            DELETE FROM user_roles destination_membership
            USING phase10c_legacy_membership_markers marker
            WHERE destination_membership."UserId" = marker.user_id
              AND destination_membership."RoleId" = marker.destination_role_id
              AND marker.destination_membership_preexisting = FALSE
              AND EXISTS
              (
                  SELECT 1
                  FROM user_roles restored_source
                  WHERE restored_source."UserId" = marker.user_id
                    AND restored_source."RoleId" = marker.source_role_id
              );
            """);

        migrationBuilder.Sql(
            """
            DELETE FROM geographic_authorizations scope
            USING phase10c_geographic_scope_markers marker
            WHERE scope."Id" = marker.created_id;

            DELETE FROM role_claims claim
            USING phase10c_role_claim_markers marker
            WHERE claim."Id" = marker.created_id;

            DROP TABLE phase10c_role_claim_markers;
            DROP TABLE phase10c_geographic_scope_markers;
            DROP TABLE phase10c_legacy_membership_markers;
            """);
    }
}
