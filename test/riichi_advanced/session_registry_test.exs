defmodule RiichiAdvanced.SessionRegistryTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  alias RiichiAdvanced.SessionRegistry
  alias RiichiAdvanced.ValkeyAdapter

  # Validates: Requirements 4.5, 4.6

  @prefix "session_registry:"

  # Helper to build the same Valkey key that SessionRegistry uses internally
  defp registry_key(name, ruleset, room_code), do: @prefix <> "#{name}-#{ruleset}-#{room_code}"

  # Clean up keys created during tests
  defp cleanup(name, ruleset, room_code) do
    ValkeyAdapter.command(["DEL", registry_key(name, ruleset, room_code)])
  end

  # Generate unique session identifiers per test to avoid collisions
  defp unique_session do
    id = System.unique_integer([:positive])
    {"game_#{id}", "ruleset_#{id}", "room_#{id}"}
  end

  describe "register/3 then lookup/3" do
    test "returns {:remote, node_id} when no local Registry entry exists" do
      {name, ruleset, room_code} = unique_session()

      :ok = SessionRegistry.register(name, ruleset, room_code)
      result = SessionRegistry.lookup(name, ruleset, room_code)

      assert {:remote, node_id} = result
      assert node_id == "#{Node.self()}"

      cleanup(name, ruleset, room_code)
    end
  end

  describe "unregister/3 then lookup/3" do
    test "returns :not_found after unregistering a session" do
      {name, ruleset, room_code} = unique_session()

      :ok = SessionRegistry.register(name, ruleset, room_code)
      assert {:remote, _} = SessionRegistry.lookup(name, ruleset, room_code)

      :ok = SessionRegistry.unregister(name, ruleset, room_code)
      assert :not_found == SessionRegistry.lookup(name, ruleset, room_code)
    end
  end

  describe "lookup/3 for non-existent session" do
    test "returns :not_found when session was never registered" do
      {name, ruleset, room_code} = unique_session()

      assert :not_found == SessionRegistry.lookup(name, ruleset, room_code)
    end
  end

  describe "refresh/3 resets TTL" do
    test "TTL is reset to 30 seconds after refresh" do
      {name, ruleset, room_code} = unique_session()
      key = registry_key(name, ruleset, room_code)

      :ok = SessionRegistry.register(name, ruleset, room_code)

      # Verify initial TTL is set
      {:ok, initial_ttl} = ValkeyAdapter.command(["TTL", key])
      assert initial_ttl > 0
      assert initial_ttl <= 30

      # Wait briefly so TTL decreases
      Process.sleep(1100)

      {:ok, decreased_ttl} = ValkeyAdapter.command(["TTL", key])
      assert decreased_ttl < initial_ttl

      # Refresh should reset TTL back to 30
      :ok = SessionRegistry.refresh(name, ruleset, room_code)

      {:ok, refreshed_ttl} = ValkeyAdapter.command(["TTL", key])
      assert refreshed_ttl > decreased_ttl
      assert refreshed_ttl <= 30

      cleanup(name, ruleset, room_code)
    end

    test "refresh returns error for non-existent session" do
      {name, ruleset, room_code} = unique_session()

      assert {:error, :not_found} == SessionRegistry.refresh(name, ruleset, room_code)
    end
  end

  describe "TTL is set to 30 seconds on register" do
    test "registered session has TTL of 30 seconds" do
      {name, ruleset, room_code} = unique_session()
      key = registry_key(name, ruleset, room_code)

      :ok = SessionRegistry.register(name, ruleset, room_code)

      {:ok, ttl} = ValkeyAdapter.command(["TTL", key])
      assert ttl > 0
      assert ttl <= 30

      cleanup(name, ruleset, room_code)
    end
  end
end
