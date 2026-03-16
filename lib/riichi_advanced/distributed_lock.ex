defmodule RiichiAdvanced.DistributedLock do
  @moduledoc """
  Valkeyベースの分散ロック。Room単位でのゲーム操作の排他制御に使用。
  Redlockアルゴリズムの簡易版を実装。
  """

  alias RiichiAdvanced.ValkeyAdapter

  @prefix "lock:"
  @default_ttl 5000  # 5秒

  @doc """
  指定リソースのロックを取得する。
  成功時はロック解放に必要なトークンを返す。
  既にロックされている場合は `{:error, :locked}` を返す。

  ## Options
    - `:ttl` - ロックのTTL（ミリ秒）。デフォルト5000ms。デッドロック防止用。
  """
  @spec acquire(String.t(), keyword()) :: {:ok, String.t()} | {:error, :locked}
  def acquire(resource, opts \\ []) do
    ttl = Keyword.get(opts, :ttl, @default_ttl)
    token = :crypto.strong_rand_bytes(16) |> Base.encode16()
    key = @prefix <> resource

    case ValkeyAdapter.command(["SET", key, token, "NX", "PX", ttl]) do
      {:ok, "OK"} -> {:ok, token}
      _ -> {:error, :locked}
    end
  end

  @doc """
  指定リソースのロックを解放する。
  Luaスクリプトでアトミックに所有者確認と削除を実行する。
  トークンが一致しない場合は `{:error, :not_owner}` を返す。
  """
  @spec release(String.t(), String.t()) :: :ok | {:error, :not_owner}
  def release(resource, token) do
    key = @prefix <> resource

    # Luaスクリプトでアトミックに所有者確認と削除を実行
    script = """
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
    """

    case ValkeyAdapter.command(["EVAL", script, "1", key, token]) do
      {:ok, 1} -> :ok
      _ -> {:error, :not_owner}
    end
  end
end
