using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Npgsql;
using StajProject.Infrastructure.Persistence.Migrations;

namespace StajProject.Auth.Tests;

/// <summary>
/// Set STAJPROJECT_MIGRATION_TEST_CONNECTION to a disposable PostGIS database
/// to execute the behavioral assertions. SQL-shape assertions always run.
/// </summary>
public class LegacyRoleMembershipMigrationTests
{
    private const string ConnectionVariable = "STAJPROJECT_MIGRATION_TEST_CONNECTION";

    [Fact]
    public async Task Up_migrates_each_membership_once_without_touching_user_or_permission_state()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.SeedCanonicalFixtureAsync();
        await database.ExecuteUpAsync();

        Assert.Equal(0, await database.ScalarAsync<int>("SELECT count(*) FROM user_roles WHERE \"RoleId\" IN (1, 3);"));
        Assert.Equal(3, await database.ScalarAsync<int>("SELECT count(*) FROM user_roles WHERE \"RoleId\" = 2;"));
        Assert.Equal(3, await database.ScalarAsync<int>("SELECT count(*) FROM user_roles WHERE \"RoleId\" = 4;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM user_roles WHERE \"UserId\" = 101 AND \"RoleId\" = 5;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM user_permissions WHERE user_id = 101 AND permission_id = 99;"));
        Assert.Equal(3, await database.ScalarAsync<int>("SELECT account_status FROM users WHERE \"Id\" = 101;"));
        Assert.True(await database.ScalarAsync<bool>("SELECT \"TwoFactorEnabled\" FROM users WHERE \"Id\" = 101;"));
        Assert.Equal(5, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
        Assert.Equal(7, await database.ScalarAsync<int>("SELECT count(*) FROM role_permissions;"));
        Assert.Equal(2, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"RoleId\" = 2 AND \"UserId\" IN (101, 103);"));
    }

    [Fact]
    public async Task Up_is_idempotent_for_existing_destination_and_dual_memberships()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.SeedCanonicalFixtureAsync();
        await database.ExecuteUpAsync();
        await database.ExecuteUpAsync();

        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 103 AND \"RoleId\" = 2;"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 104 AND \"RoleId\" = 4;"));
        Assert.Equal(4, await database.ScalarAsync<int>(
            "SELECT count(*) FROM phase10c_legacy_membership_markers;"));
    }

    [Fact]
    public async Task Missing_source_is_no_op_but_missing_destination_fails_before_membership_change()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.ExecuteAsync(
            """
            INSERT INTO roles ("Id", "Name", "NormalizedName") VALUES
                (2, 'Administrator', 'ADMINISTRATOR'),
                (4, 'GIS Editor', 'GIS EDITOR');
            INSERT INTO users ("Id", account_status, "TwoFactorEnabled") VALUES (201, 2, FALSE);
            INSERT INTO user_roles ("UserId", "RoleId") VALUES (201, 2);
            """);

        await database.ExecuteUpAsync();
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM user_roles;"));

        await database.ResetAsync();
        await database.ExecuteAsync(
            """
            INSERT INTO roles ("Id", "Name", "NormalizedName") VALUES (1, 'Admin', 'ADMIN');
            INSERT INTO users ("Id", account_status, "TwoFactorEnabled") VALUES (202, 2, FALSE);
            INSERT INTO user_roles ("UserId", "RoleId") VALUES (202, 1);
            """);

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());
        Assert.Contains("destination role ADMINISTRATOR is missing", error.MessageText);
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 202 AND \"RoleId\" = 1;"));
    }

    [Fact]
    public async Task Equal_permission_counts_with_different_sets_fail_safely()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.ExecuteAsync(
            """
            INSERT INTO roles ("Id", "Name", "NormalizedName") VALUES
                (1, 'Admin', 'ADMIN'), (2, 'Administrator', 'ADMINISTRATOR');
            INSERT INTO users ("Id", account_status, "TwoFactorEnabled") VALUES (301, 2, FALSE);
            INSERT INTO user_roles ("UserId", "RoleId") VALUES (301, 1);
            INSERT INTO role_permissions (role_id, permission_id) VALUES (1, 10), (2, 11);
            """);

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());
        Assert.Contains("role-permission sets differ", error.MessageText);
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 301 AND \"RoleId\" = 1;"));
        Assert.Equal(0, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 301 AND \"RoleId\" = 2;"));
    }

    [Fact]
    public async Task Geographic_scopes_and_role_claims_are_copied_without_deleting_legacy_rows()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.SeedCanonicalFixtureAsync();
        await database.ExecuteAsync(
            """
            INSERT INTO geographic_authorizations
                (role_id, name, source_type, source_key, area, created_date, modified_date)
            VALUES
                (1, 'Legacy scope', 0, NULL,
                 ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), now(), now()),
                (3, 'Existing scope', 0, 'same',
                 ST_GeomFromText('POLYGON((2 2,2 3,3 3,3 2,2 2))', 4326), now(), now()),
                (4, 'Existing scope', 0, 'same',
                 ST_GeomFromText('POLYGON((2 2,2 3,3 3,3 2,2 2))', 4326), now(), now());
            INSERT INTO role_claims ("RoleId", "ClaimType", "ClaimValue") VALUES
                (1, 'legacy-claim', 'allowed'),
                (3, 'existing-claim', 'allowed'),
                (4, 'existing-claim', 'allowed');
            """);

        await database.ExecuteUpAsync();
        await database.ExecuteUpAsync();

        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM geographic_authorizations WHERE role_id = 1 AND name = 'Legacy scope';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM geographic_authorizations WHERE role_id = 2 AND name = 'Legacy scope';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM geographic_authorizations WHERE role_id = 4 AND name = 'Existing scope';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 1 AND \"ClaimType\" = 'legacy-claim';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 2 AND \"ClaimType\" = 'legacy-claim';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 4 AND \"ClaimType\" = 'existing-claim';"));
    }

    [Fact]
    public async Task Down_restores_only_migration_removed_sources_and_removes_only_migration_created_data()
    {
        AssertSafeSqlShape();
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null)
        {
            return;
        }

        await database.SeedCanonicalFixtureAsync();
        await database.ExecuteAsync(
            """
            INSERT INTO role_claims ("RoleId", "ClaimType", "ClaimValue") VALUES
                (1, 'copied', 'yes'), (2, 'preexisting', 'yes');
            INSERT INTO geographic_authorizations
                (role_id, name, source_type, source_key, area, created_date, modified_date)
            VALUES
                (1, 'rollback-scope', 0, NULL,
                 ST_GeomFromText('POLYGON((5 5,5 6,6 6,6 5,5 5))', 4326), now(), now());
            """);
        await database.ExecuteUpAsync();
        await database.ExecuteDownAsync();

        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 101 AND \"RoleId\" = 1;"));
        Assert.Equal(0, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 101 AND \"RoleId\" = 2;"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 103 AND \"RoleId\" = 1;"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 103 AND \"RoleId\" = 2;"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM user_roles WHERE \"UserId\" = 105 AND \"RoleId\" = 2;"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 1 AND \"ClaimType\" = 'copied';"));
        Assert.Equal(0, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 2 AND \"ClaimType\" = 'copied';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM role_claims WHERE \"RoleId\" = 2 AND \"ClaimType\" = 'preexisting';"));
        Assert.Equal(1, await database.ScalarAsync<int>(
            "SELECT count(*) FROM geographic_authorizations WHERE role_id = 1 AND name = 'rollback-scope';"));
        Assert.Equal(0, await database.ScalarAsync<int>(
            "SELECT count(*) FROM geographic_authorizations WHERE role_id = 2 AND name = 'rollback-scope';"));
    }

    private static void AssertSafeSqlShape()
    {
        var up = string.Join('\n', MigrationSql.Up);
        var down = string.Join('\n', MigrationSql.Down);

        Assert.DoesNotContain("user_permissions", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM roles", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM role_permissions", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE users", up, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ON CONFLICT (\"UserId\", \"RoleId\") DO NOTHING", up);
        Assert.Contains("role-permission sets differ", up);
        Assert.Contains("destination_membership_preexisting", down);
        Assert.Contains("DROP TABLE phase10c_legacy_membership_markers", down);
    }

    private static class MigrationSql
    {
        public static readonly IReadOnlyList<string> Up = Get(up: true);
        public static readonly IReadOnlyList<string> Down = Get(up: false);

        private static IReadOnlyList<string> Get(bool up)
        {
            var migration = new AccessibleMigration();
            var builder = new MigrationBuilder("Npgsql.EntityFrameworkCore.PostgreSQL");

            if (up)
            {
                migration.BuildUp(builder);
            }
            else
            {
                migration.BuildDown(builder);
            }

            return builder.Operations.OfType<SqlOperation>().Select(operation => operation.Sql).ToArray();
        }

        private sealed class AccessibleMigration : MigrateLegacyRoleMemberships
        {
            public void BuildUp(MigrationBuilder builder) => base.Up(builder);
            public void BuildDown(MigrationBuilder builder) => base.Down(builder);
        }
    }

    private sealed class MigrationDatabase : IAsyncDisposable
    {
        private readonly NpgsqlConnection _connection;
        private readonly string _schema;

        private MigrationDatabase(NpgsqlConnection connection, string schema)
        {
            _connection = connection;
            _schema = schema;
        }

        public static async Task<MigrationDatabase?> TryCreateAsync()
        {
            var connectionString = Environment.GetEnvironmentVariable(ConnectionVariable);
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                return null;
            }

            var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            var schema = $"phase10c_{Guid.NewGuid():N}";
            var database = new MigrationDatabase(connection, schema);
            await database.ExecuteAsync($"CREATE SCHEMA \"{schema}\"; SET search_path TO \"{schema}\", public;");
            await database.CreateSchemaAsync();
            return database;
        }

        public async Task SeedCanonicalFixtureAsync()
        {
            await ExecuteAsync(
                """
                INSERT INTO roles ("Id", "Name", "NormalizedName") VALUES
                    (1, 'Admin', 'ADMIN'),
                    (2, 'Administrator', 'ADMINISTRATOR'),
                    (3, 'User', 'USER'),
                    (4, 'GIS Editor', 'GIS EDITOR'),
                    (5, 'Unrelated', 'UNRELATED');
                INSERT INTO role_permissions (role_id, permission_id) VALUES
                    (1, 10), (1, 11), (2, 10), (2, 11),
                    (3, 20), (4, 20), (5, 30);
                INSERT INTO users ("Id", account_status, "TwoFactorEnabled") VALUES
                    (101, 3, TRUE), (102, 2, FALSE), (103, 2, FALSE),
                    (104, 2, FALSE), (105, 2, FALSE), (106, 2, FALSE);
                INSERT INTO user_roles ("UserId", "RoleId") VALUES
                    (101, 1), (101, 5), (102, 3), (103, 1), (103, 2),
                    (104, 3), (104, 4), (105, 2), (106, 4);
                INSERT INTO user_permissions (user_id, permission_id) VALUES (101, 99);
                """);
        }

        public Task ExecuteUpAsync() => ExecuteMigrationAsync(MigrationSql.Up);

        public Task ExecuteDownAsync() => ExecuteMigrationAsync(MigrationSql.Down);

        private async Task ExecuteMigrationAsync(IEnumerable<string> statements)
        {
            await using var transaction = await _connection.BeginTransactionAsync();
            try
            {
                foreach (var sql in statements)
                {
                    await ExecuteAsync(sql, transaction);
                }

                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var command = new NpgsqlCommand(sql, _connection);
            var value = await command.ExecuteScalarAsync();
            return (T)Convert.ChangeType(value!, typeof(T));
        }

        public async Task ResetAsync()
        {
            await ExecuteAsync($"DROP SCHEMA \"{_schema}\" CASCADE; CREATE SCHEMA \"{_schema}\"; SET search_path TO \"{_schema}\", public;");
            await CreateSchemaAsync();
        }

        public async Task ExecuteAsync(string sql, NpgsqlTransaction? transaction = null)
        {
            await using var command = new NpgsqlCommand(sql, _connection, transaction);
            await command.ExecuteNonQueryAsync();
        }

        private Task CreateSchemaAsync() => ExecuteAsync(
            """
            CREATE TABLE roles
            (
                "Id" integer PRIMARY KEY,
                "Name" text NULL,
                "NormalizedName" text NULL
            );
            CREATE TABLE users
            (
                "Id" integer PRIMARY KEY,
                account_status integer NOT NULL,
                "TwoFactorEnabled" boolean NOT NULL
            );
            CREATE TABLE user_roles
            (
                "UserId" integer NOT NULL REFERENCES users("Id"),
                "RoleId" integer NOT NULL REFERENCES roles("Id"),
                PRIMARY KEY ("UserId", "RoleId")
            );
            CREATE TABLE role_permissions
            (
                role_id integer NOT NULL REFERENCES roles("Id"),
                permission_id integer NOT NULL,
                PRIMARY KEY (role_id, permission_id)
            );
            CREATE TABLE user_permissions
            (
                user_id integer NOT NULL REFERENCES users("Id"),
                permission_id integer NOT NULL,
                PRIMARY KEY (user_id, permission_id)
            );
            CREATE TABLE role_claims
            (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                "RoleId" integer NOT NULL REFERENCES roles("Id"),
                "ClaimType" text NULL,
                "ClaimValue" text NULL
            );
            CREATE TABLE geographic_authorizations
            (
                "Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                user_id integer NULL,
                role_id integer NULL REFERENCES roles("Id"),
                name text NOT NULL,
                source_type integer NOT NULL,
                source_key text NULL,
                area geometry(Polygon,4326) NOT NULL,
                created_date timestamp with time zone NOT NULL,
                modified_date timestamp with time zone NOT NULL
            );
            """);

        public async ValueTask DisposeAsync()
        {
            try
            {
                await ExecuteAsync($"SET search_path TO public; DROP SCHEMA IF EXISTS \"{_schema}\" CASCADE;");
            }
            finally
            {
                await _connection.DisposeAsync();
            }
        }
    }
}
