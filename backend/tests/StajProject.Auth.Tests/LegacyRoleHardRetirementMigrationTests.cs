using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Npgsql;
using StajProject.Infrastructure.Persistence.Migrations;

namespace StajProject.Auth.Tests;

/// <summary>
/// Set STAJPROJECT_MIGRATION_TEST_CONNECTION to a disposable PostGIS database
/// to execute behavioral assertions. SQL-shape assertions always run.
/// </summary>
public class LegacyRoleHardRetirementMigrationTests
{
    private const string ConnectionVariable = "STAJPROJECT_MIGRATION_TEST_CONNECTION";

    [Fact]
    public void Migration_has_expected_identity_and_preserves_unrelated_tables_by_shape()
    {
        var attribute = Assert.Single(typeof(RetireLegacyRoles)
            .GetCustomAttributes(typeof(MigrationAttribute), inherit: false)
            .Cast<MigrationAttribute>());
        var up = string.Join('\n', MigrationSql.Up);

        Assert.Equal("20260820150000_RetireLegacyRoles", attribute.Id);
        Assert.Contains("DELETE FROM roles", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE FROM user_permissions", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UPDATE user_permissions", up, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DROP TABLE phase10c_", up, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("still has memberships", up);
        Assert.Contains("without a canonical equivalent", up);
        Assert.Contains("usable canonical Administrator", up);
    }

    [Theory]
    [InlineData(1, "ADMIN")]
    [InlineData(3, "USER")]
    public async Task Up_refuses_each_legacy_role_when_a_membership_exists(int roleId, string normalizedName)
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();
        await database.ExecuteAsync($"INSERT INTO user_roles (\"UserId\", \"RoleId\") VALUES (101, {roleId});");

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());

        Assert.Contains($"legacy role {normalizedName} still has memberships", error.MessageText);
        Assert.Equal(8, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
    }

    [Theory]
    [InlineData(2, "ADMINISTRATOR")]
    [InlineData(4, "GIS EDITOR")]
    public async Task Up_requires_both_canonical_destination_roles(int roleId, string normalizedName)
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();
        await database.ExecuteAsync($"DELETE FROM user_roles; DELETE FROM roles WHERE \"Id\" = {roleId};");

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());

        Assert.Contains($"canonical destination role {normalizedName}", error.MessageText);
        Assert.Equal(7, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
    }

    [Fact]
    public async Task Up_requires_a_usable_canonical_Administrator()
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();
        await database.ExecuteAsync("UPDATE users SET is_active = FALSE WHERE \"Id\" = 101;");

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());

        Assert.Contains("no usable canonical Administrator", error.MessageText);
        Assert.Equal(8, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
    }

    [Theory]
    [InlineData("INSERT INTO role_claims (\"RoleId\", \"ClaimType\", \"ClaimValue\") VALUES (1, 'unexpected', 'claim');")]
    [InlineData("INSERT INTO geographic_authorizations (role_id, name, source_type, source_key, area, created_date, modified_date) VALUES (1, 'unexpected', 0, NULL, ST_GeomFromText('POLYGON((2 2,2 3,3 3,3 2,2 2))', 4326), now(), now());")]
    public async Task Up_refuses_unmatched_legacy_claims_and_scopes(string residualSql)
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();
        await database.ExecuteAsync(residualSql);

        var error = await Assert.ThrowsAsync<PostgresException>(() => database.ExecuteUpAsync());

        Assert.Contains("without a canonical equivalent", error.MessageText);
        Assert.Equal(8, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
    }

    [Fact]
    public async Task Safe_Up_retires_only_legacy_roles_and_preserves_canonical_custom_and_direct_grants()
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();

        await database.ExecuteUpAsync();

        Assert.Equal(0, await database.ScalarAsync<int>("SELECT count(*) FROM roles WHERE \"NormalizedName\" IN ('ADMIN', 'USER');"));
        Assert.Equal(6, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
        Assert.Equal(6, await database.ScalarAsync<int>("SELECT count(*) FROM role_permissions WHERE role_id = 2;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM role_permissions WHERE role_id = 5 AND permission_id = 99;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM user_permissions WHERE user_id = 101 AND permission_id = 99;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM phase10c_legacy_membership_markers;"));
    }

    [Fact]
    public async Task Down_restores_exact_legacy_rows_grants_claims_and_scopes_for_10C_C_rollback()
    {
        await using var database = await MigrationDatabase.TryCreateAsync();
        if (database is null) return;
        await database.SeedSafeFixtureAsync();

        await database.ExecuteUpAsync();
        await database.ExecuteDownAsync();

        Assert.Equal(8, await database.ScalarAsync<int>("SELECT count(*) FROM roles;"));
        Assert.Equal("admin-stamp", await database.ScalarAsync<string>("SELECT \"ConcurrencyStamp\" FROM roles WHERE \"Id\" = 1;"));
        Assert.Equal(6, await database.ScalarAsync<int>("SELECT count(*) FROM role_permissions WHERE role_id = 1;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM role_claims WHERE \"Id\" = 31 AND \"RoleId\" = 1;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM geographic_authorizations WHERE \"Id\" = 41 AND role_id = 1;"));
        Assert.Equal(1, await database.ScalarAsync<int>("SELECT count(*) FROM phase10c_legacy_membership_markers;"));
    }

    private static class MigrationSql
    {
        public static readonly IReadOnlyList<string> Up = Get(up: true);
        public static readonly IReadOnlyList<string> Down = Get(up: false);

        private static IReadOnlyList<string> Get(bool up)
        {
            var migration = new AccessibleMigration();
            var builder = new MigrationBuilder("Npgsql.EntityFrameworkCore.PostgreSQL");
            if (up) migration.BuildUp(builder); else migration.BuildDown(builder);
            return builder.Operations.OfType<SqlOperation>().Select(operation => operation.Sql).ToArray();
        }

        private sealed class AccessibleMigration : RetireLegacyRoles
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
            if (string.IsNullOrWhiteSpace(connectionString)) return null;
            var connection = new NpgsqlConnection(connectionString);
            await connection.OpenAsync();
            var schema = $"phase10e_{Guid.NewGuid():N}";
            var database = new MigrationDatabase(connection, schema);
            await database.ExecuteAsync($"CREATE SCHEMA \"{schema}\"; SET search_path TO \"{schema}\", public;");
            await database.CreateSchemaAsync();
            return database;
        }

        public Task ExecuteUpAsync() => ExecuteMigrationAsync(MigrationSql.Up);
        public Task ExecuteDownAsync() => ExecuteMigrationAsync(MigrationSql.Down);

        public async Task SeedSafeFixtureAsync() => await ExecuteAsync(
            """
            INSERT INTO roles ("Id", "Name", "NormalizedName", "ConcurrencyStamp") VALUES
                (1, 'Admin', 'ADMIN', 'admin-stamp'),
                (2, 'Administrator', 'ADMINISTRATOR', 'administrator-stamp'),
                (3, 'User', 'USER', 'user-stamp'),
                (4, 'GIS Editor', 'GIS EDITOR', 'editor-stamp'),
                (5, 'Field Surveyor', 'FIELD SURVEYOR', 'custom-stamp'),
                (6, 'Viewer', 'VIEWER', 'viewer-stamp'),
                (7, 'GIS Analyst', 'GIS ANALYST', 'analyst-stamp'),
                (8, 'GIS Manager', 'GIS MANAGER', 'manager-stamp');
            INSERT INTO permissions ("Id", code, is_active) VALUES
                (10, 'users.view', TRUE), (11, 'users.update', TRUE),
                (12, 'roles.view', TRUE), (13, 'roles.update', TRUE),
                (14, 'permissions.view', TRUE), (15, 'permissions.assign', TRUE),
                (20, 'drawings.view', TRUE), (99, 'custom.permission', TRUE);
            INSERT INTO role_permissions (role_id, permission_id) VALUES
                (1,10),(1,11),(1,12),(1,13),(1,14),(1,15),
                (2,10),(2,11),(2,12),(2,13),(2,14),(2,15),
                (3,20),(4,20),(5,99);
            INSERT INTO users ("Id", is_deleted, is_active, account_status) VALUES (101, FALSE, TRUE, 2);
            INSERT INTO user_roles ("UserId", "RoleId") VALUES (101, 2);
            INSERT INTO user_permissions (user_id, permission_id) VALUES (101, 99);
            INSERT INTO role_claims ("Id", "RoleId", "ClaimType", "ClaimValue") VALUES
                (31, 1, 'legacy', 'allowed'), (32, 2, 'legacy', 'allowed');
            INSERT INTO geographic_authorizations
                ("Id", role_id, name, source_type, source_key, area, created_date, modified_date)
            VALUES
                (41, 1, 'scope', 0, NULL, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), now(), now()),
                (42, 2, 'scope', 0, NULL, ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))', 4326), now(), now());
            INSERT INTO phase10c_legacy_membership_markers VALUES (999, 1, 2, FALSE);
            """);

        public async Task<T> ScalarAsync<T>(string sql)
        {
            await using var command = new NpgsqlCommand(sql, _connection);
            var value = await command.ExecuteScalarAsync();
            return (T)Convert.ChangeType(value!, typeof(T));
        }

        public async Task ExecuteAsync(string sql, NpgsqlTransaction? transaction = null)
        {
            await using var command = new NpgsqlCommand(sql, _connection, transaction);
            await command.ExecuteNonQueryAsync();
        }

        private async Task ExecuteMigrationAsync(IEnumerable<string> statements)
        {
            await using var transaction = await _connection.BeginTransactionAsync();
            try
            {
                foreach (var sql in statements) await ExecuteAsync(sql, transaction);
                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        }

        private Task CreateSchemaAsync() => ExecuteAsync(
            """
            CREATE TABLE roles ("Id" integer PRIMARY KEY, "Name" varchar(100), "NormalizedName" varchar(100), "ConcurrencyStamp" text);
            CREATE TABLE permissions ("Id" integer PRIMARY KEY, code text NOT NULL, is_active boolean NOT NULL);
            CREATE TABLE users ("Id" integer PRIMARY KEY, is_deleted boolean NOT NULL, is_active boolean NOT NULL, account_status integer NOT NULL);
            CREATE TABLE user_roles ("UserId" integer NOT NULL REFERENCES users("Id"), "RoleId" integer NOT NULL REFERENCES roles("Id") ON DELETE CASCADE, PRIMARY KEY ("UserId", "RoleId"));
            CREATE TABLE role_permissions (role_id integer NOT NULL REFERENCES roles("Id") ON DELETE CASCADE, permission_id integer NOT NULL REFERENCES permissions("Id"), PRIMARY KEY (role_id, permission_id));
            CREATE TABLE user_permissions (user_id integer NOT NULL REFERENCES users("Id"), permission_id integer NOT NULL REFERENCES permissions("Id"), PRIMARY KEY (user_id, permission_id));
            CREATE TABLE role_claims ("Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "RoleId" integer NOT NULL REFERENCES roles("Id") ON DELETE CASCADE, "ClaimType" text, "ClaimValue" text);
            CREATE TABLE geographic_authorizations ("Id" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, role_id integer REFERENCES roles("Id") ON DELETE CASCADE, name text NOT NULL, source_type integer NOT NULL, source_key text, area geometry(Polygon,4326) NOT NULL, created_date timestamptz NOT NULL, modified_date timestamptz NOT NULL);
            CREATE TABLE phase10c_legacy_membership_markers (user_id integer, source_role_id integer, destination_role_id integer, destination_membership_preexisting boolean);
            CREATE TABLE phase10c_geographic_scope_markers (created_id integer PRIMARY KEY);
            CREATE TABLE phase10c_role_claim_markers (created_id integer PRIMARY KEY);
            """);

        public async ValueTask DisposeAsync()
        {
            try { await ExecuteAsync($"SET search_path TO public; DROP SCHEMA IF EXISTS \"{_schema}\" CASCADE;"); }
            finally { await _connection.DisposeAsync(); }
        }
    }
}
