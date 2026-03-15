defmodule RiichiAdvanced.NebulexCacheTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  # Validates: Requirements 3.3 (API互換性、既存コードとの統合)

  # Helper to generate unique keys per test to avoid collisions
  defp unique_key(prefix \\ "neb_test") do
    "#{prefix}_#{System.unique_integer([:positive])}"
  end

  describe "put/2 and get/1 basic round-trip" do
    test "stores and retrieves a value" do
      key = unique_key()
      :ok = RiichiAdvanced.Cache.put(key, "hello")
      assert RiichiAdvanced.Cache.get(key) == "hello"
    end
  end

  describe "get/1 for non-existent keys" do
    test "returns nil for a key that was never set" do
      key = unique_key("missing")
      assert RiichiAdvanced.Cache.get(key) == nil
    end
  end

  describe "delete/1 removes a key" do
    test "key returns nil after deletion" do
      key = unique_key("del")
      :ok = RiichiAdvanced.Cache.put(key, "to_delete")
      assert RiichiAdvanced.Cache.get(key) == "to_delete"

      RiichiAdvanced.Cache.delete(key)
      assert RiichiAdvanced.Cache.get(key) == nil
    end
  end

  describe "put/3 with TTL option" do
    test "entry expires after the given TTL" do
      key = unique_key("ttl")
      # Set a 1-second TTL
      :ok = RiichiAdvanced.Cache.put(key, "ephemeral", ttl: :timer.seconds(1))
      assert RiichiAdvanced.Cache.get(key) == "ephemeral"

      # Wait for expiration
      Process.sleep(1_500)
      assert RiichiAdvanced.Cache.get(key) == nil
    end
  end

  describe "works with types commonly used in the codebase" do
    test "string values" do
      key = unique_key("str")
      :ok = RiichiAdvanced.Cache.put(key, "some string value")
      assert RiichiAdvanced.Cache.get(key) == "some string value"
    end

    test "map values" do
      key = unique_key("map")
      value = %{"name" => "test", "count" => 42, "nested" => %{"a" => 1}}
      :ok = RiichiAdvanced.Cache.put(key, value)
      assert RiichiAdvanced.Cache.get(key) == value
    end

    test "list values" do
      key = unique_key("list")
      value = [1, "two", 3, [4, 5]]
      :ok = RiichiAdvanced.Cache.put(key, value)
      assert RiichiAdvanced.Cache.get(key) == value
    end
  end
end
