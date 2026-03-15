# Feature: valkey-state-migration, Property 2: ValkeyCacheの書き込み/読み取りラウンドトリップ
defmodule RiichiAdvanced.ValkeyCachePropertyTest do
  use ExUnit.Case, async: false
  use ExUnitProperties

  alias RiichiAdvanced.ValkeyCache

  @moduletag :valkey

  # Generator for cache table names (the 4 supported tables)
  defp cache_table do
    member_of([:cache_mods, :cache_rulesets, :cache_configs, :cache_sequences])
  end

  # Generator for cache keys - strings and integers that produce distinct hashes
  defp cache_key do
    one_of([
      string(:alphanumeric, min_length: 1, max_length: 20),
      positive_integer()
    ])
  end

  # Simple generators for cache values - strings, integers, small lists, small maps
  defp cache_value do
    one_of([
      integer(),
      string(:alphanumeric, max_length: 20),
      list_of(integer(), max_length: 5),
      list_of(string(:alphanumeric, max_length: 10), max_length: 5),
      map_of(string(:alphanumeric, max_length: 10), integer(), max_length: 5),
      constant(true),
      constant(false),
      constant(nil)
    ])
  end

  # **Validates: Requirements 2.2**
  property "put/3 then get/3 returns [value] for any key-value pair" do
    check all key <- cache_key(),
              value <- cache_value(),
              table <- cache_table(),
              max_runs: 25 do
      :ok = ValkeyCache.put(key, value, table)
      result = ValkeyCache.get(key, [], table)

      assert result == [value]
    end
  end
end
