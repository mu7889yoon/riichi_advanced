defmodule RiichiAdvanced.ValkeyCache do
  @moduledoc """
  ETSCacheのValkey移行版。同一インターフェースを提供する。
  cache_mods、cache_rulesets、cache_configs、cache_sequencesの4テーブルに対応。
  """

  alias RiichiAdvanced.ValkeyAdapter
  alias RiichiAdvanced.StateSerializer

  @max_size 1000
  @default_ttl 3600  # 1時間（秒）

  @doc """
  キャッシュからデータを取得する。
  キーが存在しない場合やエラー時はdefaultを返す。
  成功時は [value] のリストを返す（ETSCacheと同一インターフェース）。
  """
  @spec get(term(), term(), atom()) :: list()
  def get(key, default \\ [], table \\ :cache) do
    cache_key = make_key(table, key)

    case ValkeyAdapter.command(["GET", cache_key]) do
      {:ok, nil} ->
        default

      {:ok, binary} ->
        case StateSerializer.deserialize(binary) do
          {:ok, value} -> [value]
          {:error, _} -> default
        end

      {:error, _} ->
        default
    end
  end

  @doc """
  キャッシュにデータを書き込む。
  StateSerializerでシリアライズし、TTL付きでValkeyに保存する。
  """
  @spec put(term(), term(), atom()) :: :ok
  def put(key, value, table \\ :cache) do
    cache_key = make_key(table, key)
    binary = StateSerializer.serialize(value)
    ValkeyAdapter.command(["SET", cache_key, binary, "EX", @default_ttl])
    :ok
  end

  defp make_key(table, key) do
    "cache:#{table}:#{:erlang.phash2(key)}"
  end
end
