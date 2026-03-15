# Feature: valkey-state-migration, Property 3: Nebulex Cacheの書き込み/読み取りラウンドトリップ
defmodule RiichiAdvanced.NebulexCachePropertyTest do
  use ExUnit.Case, async: false
  use ExUnitProperties

  @moduletag :valkey

  # Generator for cache keys - unique strings to avoid collisions between runs.
  # Each generated key includes a unique integer suffix.
  defp cache_key do
    bind(string(:alphanumeric, min_length: 1, max_length: 20), fn s ->
      constant("pbt_neb_#{s}_#{System.unique_integer([:positive])}")
    end)
  end

  # Generator for values that survive NebulexRedisAdapter serialization.
  # NebulexRedisAdapter uses its own serialization (not our StateSerializer),
  # so we stick to simple types: strings, integers, lists, maps with string keys.
  # Note: nil is excluded because Nebulex.Cache.get/1 returns nil for missing keys,
  # making it impossible to distinguish "stored nil" from "key not found".
  defp cache_value do
    one_of([
      integer(),
      string(:alphanumeric, min_length: 1, max_length: 20),
      list_of(integer(), max_length: 5),
      list_of(string(:alphanumeric, max_length: 10), max_length: 5),
      map_of(string(:alphanumeric, min_length: 1, max_length: 10), integer(), max_length: 5),
      constant(true),
      constant(false)
    ])
  end

  # **Validates: Requirements 3.2**
  property "put/2 then get/1 returns the original value for any key-value pair" do
    check all key <- cache_key(),
              value <- cache_value(),
              max_runs: 25 do
      :ok = RiichiAdvanced.Cache.put(key, value)
      result = RiichiAdvanced.Cache.get(key)

      assert result == value
    end
  end
end
