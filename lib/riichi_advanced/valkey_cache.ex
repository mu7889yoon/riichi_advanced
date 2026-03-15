defmodule RiichiAdvanced.ValkeyCache do
  @moduledoc """
  ETSCacheのValkey移行版。同一インターフェースを提供する。
  cache_mods、cache_rulesets、cache_configs、cache_sequencesの4テーブルに対応。
  """

  alias RiichiAdvanced.ValkeyAdapter
  alias RiichiAdvanced.StateSerializer

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

  @doc """
  指定テーブルのすべてのキャッシュエントリを削除する。
  Valkeyの SCAN + DEL を使用してプレフィックスに一致するキーを削除する。
  """
  @spec clear(atom()) :: :ok
  def clear(table) do
    prefix = "cache:#{table}:*"
    do_clear(prefix, "0")
    :ok
  end

  defp do_clear(prefix, cursor) do
    case ValkeyAdapter.command(["SCAN", cursor, "MATCH", prefix, "COUNT", "100"]) do
      {:ok, [next_cursor, keys]} ->
        if keys != [] do
          ValkeyAdapter.command(["DEL" | keys])
        end
        if next_cursor != "0" do
          do_clear(prefix, next_cursor)
        end
      {:error, _} ->
        :ok
    end
  end

  defp make_key(table, key) do
    "cache:#{table}:#{:erlang.phash2(key)}"
  end
end
