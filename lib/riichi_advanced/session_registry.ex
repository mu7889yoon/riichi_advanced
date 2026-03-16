defmodule RiichiAdvanced.SessionRegistry do
  @moduledoc """
  Valkeyベースの分散セッションレジストリ。
  ローカルRegistryとValkeyの二層構成で動作する。

  - ローカルプロセスへのアクセスはRegistryで高速に処理
  - ノード間のセッション発見にはValkeyを使用
  - TTL（30秒）によるハートビート更新でノード障害時に自動削除
  """

  alias RiichiAdvanced.ValkeyAdapter

  @prefix "session_registry:"
  @node_ttl 30

  @doc """
  セッションをValkeyに登録する。
  現在のノード識別子をTTL付きで保存する。
  """
  @spec register(String.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def register(name, ruleset, room_code) do
    key = registry_key(name, ruleset, room_code)
    node_id = node_identifier()

    case ValkeyAdapter.command(["SET", @prefix <> key, node_id, "EX", @node_ttl]) do
      {:ok, _} -> :ok
      {:error, _} = error -> error
    end
  end

  @doc """
  セッションを検索する。
  まずローカルRegistryを確認し、見つからなければValkeyを検索する。

  戻り値:
  - `{:local, pid}` - ローカルノードにプロセスが存在
  - `{:remote, node_id}` - リモートノードにセッションが登録済み
  - `:not_found` - どこにも見つからない
  """
  @spec lookup(String.t(), String.t(), String.t()) :: {:local, pid()} | {:remote, String.t()} | :not_found
  def lookup(name, ruleset, room_code) do
    registry_name = RiichiAdvanced.Utils.to_registry_name(name, ruleset, room_code)

    case Registry.lookup(:game_registry, registry_name) do
      [{pid, _}] ->
        {:local, pid}

      [] ->
        key = registry_key(name, ruleset, room_code)

        case ValkeyAdapter.command(["GET", @prefix <> key]) do
          {:ok, nil} -> :not_found
          {:ok, node_id} -> {:remote, node_id}
          {:error, _} -> :not_found
        end
    end
  end

  @doc """
  セッションをValkeyから削除する。
  """
  @spec unregister(String.t(), String.t(), String.t()) :: :ok
  def unregister(name, ruleset, room_code) do
    key = registry_key(name, ruleset, room_code)
    ValkeyAdapter.command(["DEL", @prefix <> key])
    :ok
  end

  @doc """
  セッションのTTLを更新する（ハートビート）。
  ノードが生存していることを示すためにTTLをリセットする。
  """
  @spec refresh(String.t(), String.t(), String.t()) :: :ok | {:error, term()}
  def refresh(name, ruleset, room_code) do
    key = registry_key(name, ruleset, room_code)

    case ValkeyAdapter.command(["EXPIRE", @prefix <> key, @node_ttl]) do
      {:ok, 1} -> :ok
      {:ok, 0} -> {:error, :not_found}
      {:error, _} = error -> error
    end
  end

  defp registry_key(name, ruleset, room_code), do: "#{name}-#{ruleset}-#{room_code}"

  defp node_identifier, do: "#{Node.self()}"
end
