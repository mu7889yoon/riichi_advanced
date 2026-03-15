defmodule RiichiAdvanced.ValkeyCacheTest do
  use ExUnit.Case, async: false

  @moduletag :valkey

  alias RiichiAdvanced.ValkeyCache
  alias RiichiAdvanced.ValkeyAdapter

  # Validates: Requirements 2.1, 2.3, 2.4

  # Helper to build the same cache key that ValkeyCache uses internally
  defp cache_key(table, key), do: "cache:#{table}:#{:erlang.phash2(key)}"

  # Clean up keys created during tests
  defp cleanup_key(table, key) do
    ValkeyAdapter.command(["DEL", cache_key(table, key)])
  end

  describe "get/3 with non-existent key" do
    test "returns default value (empty list) when key does not exist" do
      assert ValkeyCache.get("nonexistent_key_#{System.unique_integer([:positive])}", [], :cache_mods) == []
    end

    test "returns custom default when key does not exist" do
      default = :not_found
      assert ValkeyCache.get("missing_#{System.unique_integer([:positive])}", default, :cache_rulesets) == default
    end
  end

  describe "put/3 and get/3 across all 4 tables" do
    test "write and read from cache_mods" do
      key = "mod_test_#{System.unique_integer([:positive])}"
      value = %{"name" => "test_mod", "enabled" => true}

      :ok = ValkeyCache.put(key, value, :cache_mods)
      assert ValkeyCache.get(key, [], :cache_mods) == [value]

      cleanup_key(:cache_mods, key)
    end

    test "write and read from cache_rulesets" do
      key = "ruleset_test_#{System.unique_integer([:positive])}"
      value = ["rule1", "rule2", "rule3"]

      :ok = ValkeyCache.put(key, value, :cache_rulesets)
      assert ValkeyCache.get(key, [], :cache_rulesets) == [value]

      cleanup_key(:cache_rulesets, key)
    end

    test "write and read from cache_configs" do
      key = "config_test_#{System.unique_integer([:positive])}"
      value = %{timeout: 5000, retries: 3}

      :ok = ValkeyCache.put(key, value, :cache_configs)
      assert ValkeyCache.get(key, [], :cache_configs) == [value]

      cleanup_key(:cache_configs, key)
    end

    test "write and read from cache_sequences" do
      key = "seq_test_#{System.unique_integer([:positive])}"
      value = [1, 2, 3, 4, 5]

      :ok = ValkeyCache.put(key, value, :cache_sequences)
      assert ValkeyCache.get(key, [], :cache_sequences) == [value]

      cleanup_key(:cache_sequences, key)
    end
  end

  describe "TTL on entries" do
    test "entries have TTL set to 3600 seconds" do
      key = "ttl_test_#{System.unique_integer([:positive])}"
      :ok = ValkeyCache.put(key, "ttl_value", :cache_mods)

      {:ok, ttl} = ValkeyAdapter.command(["TTL", cache_key(:cache_mods, key)])

      # TTL should be positive and at most 3600 (could be slightly less due to timing)
      assert ttl > 0
      assert ttl <= 3600

      cleanup_key(:cache_mods, key)
    end
  end

  describe "clear/1" do
    test "removes all entries for a specific table" do
      keys = for i <- 1..3, do: "clear_test_#{i}_#{System.unique_integer([:positive])}"

      # Write entries to the target table
      for key <- keys do
        ValkeyCache.put(key, "value_#{key}", :cache_configs)
      end

      # Write an entry to a different table that should NOT be cleared
      other_key = "other_table_#{System.unique_integer([:positive])}"
      ValkeyCache.put(other_key, "should_survive", :cache_mods)

      # Clear only cache_configs
      :ok = ValkeyCache.clear(:cache_configs)

      # Entries in cache_configs should be gone
      for key <- keys do
        assert ValkeyCache.get(key, :deleted, :cache_configs) == :deleted
      end

      # Entry in cache_mods should still exist
      assert ValkeyCache.get(other_key, :deleted, :cache_mods) == ["should_survive"]

      cleanup_key(:cache_mods, other_key)
    end
  end
end
