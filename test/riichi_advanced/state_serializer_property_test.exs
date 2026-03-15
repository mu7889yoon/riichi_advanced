# Feature: valkey-state-migration, Property 1: キャッシュデータのシリアライズ/デシリアライズ ラウンドトリップ
defmodule RiichiAdvanced.StateSerializerPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias RiichiAdvanced.StateSerializer

  # Generator for safe atoms (only pre-existing atoms in the BEAM VM).
  # The :safe option in binary_to_term prevents creation of new atoms,
  # so we must only use atoms that already exist.
  defp safe_atom do
    member_of([:ok, :error, true, false, nil, :undefined, :infinity, :normal, :timeout])
  end

  # Recursive generator for arbitrary Elixir terms
  defp elixir_term do
    tree(leaf_term(), fn inner ->
      one_of([
        # Lists
        list_of(inner, max_length: 5),
        # Maps with string/atom keys and arbitrary values
        map_of(one_of([string(:alphanumeric, max_length: 10), safe_atom()]), inner, max_length: 5),
        # Tuples (2 to 4 elements)
        tuple({inner, inner}),
        tuple({inner, inner, inner}),
        # MapSet from a list of leaf terms
        bind(list_of(leaf_term(), max_length: 5), fn items ->
          constant(MapSet.new(items))
        end),
        # Keyword lists
        list_of(tuple({safe_atom(), inner}), max_length: 5)
      ])
    end)
  end

  defp leaf_term do
    one_of([
      integer(),
      float(),
      binary(max_length: 50),
      string(:alphanumeric, max_length: 20),
      safe_atom(),
      constant(nil),
      constant(true),
      constant(false),
      constant([]),
      constant(%{})
    ])
  end

  # **Validates: Requirements 2.5, 2.6, 2.7**
  property "serialize/1 |> deserialize/1 round-trip preserves data equality" do
    check all term <- elixir_term(), max_runs: 100 do
      serialized = StateSerializer.serialize(term)
      assert is_binary(serialized)

      assert {:ok, deserialized} = StateSerializer.deserialize(serialized)
      assert deserialized == term
    end
  end
end
