using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// Removes the retired Admin/User role rows after proving their canonical
/// replacements are complete. Exact source data is archived for a guarded Down.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260820150000_RetireLegacyRoles")]
public partial class RetireLegacyRoles : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(
            """
            CREATE TABLE phase10e_legacy_role_markers
            (
                role_id integer PRIMARY KEY,
                name character varying(100) NULL,
                normalized_name character varying(100) NULL,
                concurrency_stamp text NULL
            );

            CREATE TABLE phase10e_role_permission_markers
            (
                role_id integer NOT NULL,
                permission_id integer NOT NULL,
                PRIMARY KEY (role_id, permission_id)
            );

            CREATE TABLE phase10e_role_claim_markers
            (
                id integer PRIMARY KEY,
                role_id integer NOT NULL,
                claim_type text NULL,
                claim_value text NULL
            );

            CREATE TABLE phase10e_geographic_scope_markers
            (
                id integer PRIMARY KEY,
                role_id integer NOT NULL,
                name text NOT NULL,
                source_type integer NOT NULL,
                source_key text NULL,
                area geometry(Polygon,4326) NOT NULL,
                created_date timestamp with time zone NOT NULL,
                modified_date timestamp with time zone NOT NULL
            );
            """);

        // Resolve every role exactly once and reject any state in which a
        // cascade could discard memberships or source-only claims/scopes.
        migrationBuilder.Sql(
            """
            DO $phase10e$
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
                    SELECT array_agg(r."Id" ORDER BY r."Id") INTO source_ids
                    FROM roles r
                    WHERE upper(btrim(r."NormalizedName")) = mapping.source_normalized_name
                       OR upper(btrim(r."Name")) = mapping.source_normalized_name;

                    SELECT array_agg(r."Id" ORDER BY r."Id") INTO destination_ids
                    FROM roles r
                    WHERE upper(btrim(r."NormalizedName")) = mapping.destination_normalized_name
                       OR upper(btrim(r."Name")) = mapping.destination_normalized_name;

                    IF cardinality(source_ids) IS DISTINCT FROM 1 THEN
                        RAISE EXCEPTION
                            'Phase 10C-E1: expected exactly one legacy role %, found %',
                            mapping.source_normalized_name,
                            coalesce(cardinality(source_ids), 0);
                    END IF;

                    IF cardinality(destination_ids) IS DISTINCT FROM 1 THEN
                        RAISE EXCEPTION
                            'Phase 10C-E1: expected exactly one canonical destination role %, found %',
                            mapping.destination_normalized_name,
                            coalesce(cardinality(destination_ids), 0);
                    END IF;

                    source_id := source_ids[1];
                    destination_id := destination_ids[1];

                    IF EXISTS (SELECT 1 FROM user_roles ur WHERE ur."RoleId" = source_id) THEN
                        RAISE EXCEPTION
                            'Phase 10C-E1: legacy role % still has memberships; no roles were deleted',
                            mapping.source_normalized_name;
                    END IF;

                    IF EXISTS
                    (
                        SELECT 1
                        FROM role_claims source_claim
                        WHERE source_claim."RoleId" = source_id
                          AND NOT EXISTS
                          (
                              SELECT 1
                              FROM role_claims destination_claim
                              WHERE destination_claim."RoleId" = destination_id
                                AND destination_claim."ClaimType" IS NOT DISTINCT FROM source_claim."ClaimType"
                                AND destination_claim."ClaimValue" IS NOT DISTINCT FROM source_claim."ClaimValue"
                          )
                    ) THEN
                        RAISE EXCEPTION
                            'Phase 10C-E1: legacy role % has a claim without a canonical equivalent',
                            mapping.source_normalized_name;
                    END IF;

                    IF EXISTS
                    (
                        SELECT 1
                        FROM geographic_authorizations source_scope
                        WHERE source_scope.role_id = source_id
                          AND NOT EXISTS
                          (
                              SELECT 1
                              FROM geographic_authorizations destination_scope
                              WHERE destination_scope.role_id = destination_id
                                AND destination_scope.name = source_scope.name
                                AND destination_scope.source_type = source_scope.source_type
                                AND destination_scope.source_key IS NOT DISTINCT FROM source_scope.source_key
                                AND ST_Equals(destination_scope.area, source_scope.area)
                          )
                    ) THEN
                        RAISE EXCEPTION
                            'Phase 10C-E1: legacy role % has a geographic scope without a canonical equivalent',
                            mapping.source_normalized_name;
                    END IF;
                END LOOP;

                IF NOT EXISTS
                (
                    SELECT 1
                    FROM users u
                    JOIN user_roles administrator_membership
                      ON administrator_membership."UserId" = u."Id"
                    JOIN roles administrator_role
                      ON administrator_role."Id" = administrator_membership."RoleId"
                    WHERE upper(btrim(administrator_role."NormalizedName")) = 'ADMINISTRATOR'
                      AND u.is_deleted = FALSE
                      AND u.is_active = TRUE
                      AND u.account_status = 2
                      AND 6 =
                      (
                          SELECT count(DISTINCT permission.code)
                          FROM permissions permission
                          WHERE permission.is_active = TRUE
                            AND permission.code IN
                                ('users.view', 'users.update', 'roles.view', 'roles.update',
                                 'permissions.view', 'permissions.assign')
                            AND
                            (
                                EXISTS
                                (
                                    SELECT 1
                                    FROM user_roles effective_membership
                                    JOIN role_permissions role_grant
                                      ON role_grant.role_id = effective_membership."RoleId"
                                    WHERE effective_membership."UserId" = u."Id"
                                      AND role_grant.permission_id = permission."Id"
                                )
                                OR EXISTS
                                (
                                    SELECT 1
                                    FROM user_permissions direct_grant
                                    WHERE direct_grant.user_id = u."Id"
                                      AND direct_grant.permission_id = permission."Id"
                                )
                            )
                      )
                ) THEN
                    RAISE EXCEPTION
                        'Phase 10C-E1: no usable canonical Administrator with all critical permissions exists';
                END IF;
            END
            $phase10e$;
            """);

        // Archive exact source state before the deliberate role cascade.
        migrationBuilder.Sql(
            """
            INSERT INTO phase10e_legacy_role_markers
                (role_id, name, normalized_name, concurrency_stamp)
            SELECT r."Id", r."Name", r."NormalizedName", r."ConcurrencyStamp"
            FROM roles r
            WHERE upper(btrim(r."NormalizedName")) IN ('ADMIN', 'USER')
               OR upper(btrim(r."Name")) IN ('ADMIN', 'USER');

            INSERT INTO phase10e_role_permission_markers (role_id, permission_id)
            SELECT rp.role_id, rp.permission_id
            FROM role_permissions rp
            JOIN phase10e_legacy_role_markers marker ON marker.role_id = rp.role_id;

            INSERT INTO phase10e_role_claim_markers (id, role_id, claim_type, claim_value)
            SELECT claim."Id", claim."RoleId", claim."ClaimType", claim."ClaimValue"
            FROM role_claims claim
            JOIN phase10e_legacy_role_markers marker ON marker.role_id = claim."RoleId";

            INSERT INTO phase10e_geographic_scope_markers
                (id, role_id, name, source_type, source_key, area, created_date, modified_date)
            SELECT scope."Id", scope.role_id, scope.name, scope.source_type, scope.source_key,
                   scope.area, scope.created_date, scope.modified_date
            FROM geographic_authorizations scope
            JOIN phase10e_legacy_role_markers marker ON marker.role_id = scope.role_id;

            DELETE FROM roles retired
            USING phase10e_legacy_role_markers marker
            WHERE retired."Id" = marker.role_id;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Refuse rollback before changing anything if exact identifiers cannot
        // be restored. The 10C-C markers remain available for its later Down.
        migrationBuilder.Sql(
            """
            DO $phase10e_down$
            BEGIN
                IF EXISTS
                (
                    SELECT 1
                    FROM phase10e_legacy_role_markers marker
                    JOIN roles existing
                      ON existing."Id" = marker.role_id
                      OR upper(btrim(existing."NormalizedName")) = upper(btrim(marker.normalized_name))
                      OR upper(btrim(existing."Name")) = upper(btrim(marker.name))
                ) THEN
                    RAISE EXCEPTION
                        'Phase 10C-E1 rollback: a legacy role id or normalized name is already occupied';
                END IF;

                IF EXISTS
                (
                    SELECT 1
                    FROM phase10e_role_permission_markers marker
                    LEFT JOIN permissions permission ON permission."Id" = marker.permission_id
                    WHERE permission."Id" IS NULL
                ) THEN
                    RAISE EXCEPTION
                        'Phase 10C-E1 rollback: an archived permission no longer exists';
                END IF;

                IF EXISTS
                (
                    SELECT 1 FROM phase10e_role_claim_markers marker
                    JOIN role_claims existing ON existing."Id" = marker.id
                ) OR EXISTS
                (
                    SELECT 1 FROM phase10e_geographic_scope_markers marker
                    JOIN geographic_authorizations existing ON existing."Id" = marker.id
                ) THEN
                    RAISE EXCEPTION
                        'Phase 10C-E1 rollback: an archived claim or scope id is already occupied';
                END IF;
            END
            $phase10e_down$;

            INSERT INTO roles ("Id", "Name", "NormalizedName", "ConcurrencyStamp")
            SELECT role_id, name, normalized_name, concurrency_stamp
            FROM phase10e_legacy_role_markers;

            INSERT INTO role_permissions (role_id, permission_id)
            SELECT role_id, permission_id FROM phase10e_role_permission_markers;

            INSERT INTO role_claims ("Id", "RoleId", "ClaimType", "ClaimValue")
            SELECT id, role_id, claim_type, claim_value FROM phase10e_role_claim_markers;

            INSERT INTO geographic_authorizations
                ("Id", role_id, name, source_type, source_key, area, created_date, modified_date)
            SELECT id, role_id, name, source_type, source_key, area, created_date, modified_date
            FROM phase10e_geographic_scope_markers;

            DROP TABLE phase10e_geographic_scope_markers;
            DROP TABLE phase10e_role_claim_markers;
            DROP TABLE phase10e_role_permission_markers;
            DROP TABLE phase10e_legacy_role_markers;
            """);
    }
}
