defmodule RiichiAdvanced.StateSerializer do
  @moduledoc """
  GenServer状態のシリアライズ/デシリアライズ。
  ETF (Erlang Term Format) を使用してElixirデータ構造を完全に保持する。
  """

  @spec serialize(term()) :: binary()
  def serialize(state), do: :erlang.term_to_binary(state)

  @spec deserialize(binary()) :: {:ok, term()} | {:error, :invalid_data}
  def deserialize(binary) when is_binary(binary) do
    {:ok, :erlang.binary_to_term(binary, [:safe])}
  rescue
    ArgumentError -> {:error, :invalid_data}
  end
  def deserialize(_), do: {:error, :invalid_data}
end
