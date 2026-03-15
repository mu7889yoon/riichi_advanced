defmodule RiichiAdvanced.ValkeyAdapter do
  @moduledoc """
  Valkey接続の管理とデータ操作のインターフェース。
  Redixベースのコネクションプールを提供する。
  """

  def child_spec(_opts) do
    children =
      for i <- 0..(pool_size() - 1) do
        Supervisor.child_spec(
          {Redix, {valkey_url(), [name: :"redix_#{i}"]}},
          id: {Redix, i}
        )
      end

    %{
      id: __MODULE__,
      type: :supervisor,
      start: {Supervisor, :start_link, [children, [strategy: :one_for_one]]}
    }
  end

  @spec command(list()) :: {:ok, term()} | {:error, term()}
  def command(command), do: Redix.command(random_connection(), command)

  @spec pipeline(list(list())) :: {:ok, list()} | {:error, term()}
  def pipeline(commands), do: Redix.pipeline(random_connection(), commands)

  defp random_connection, do: :"redix_#{Enum.random(0..(pool_size() - 1))}"

  defp pool_size, do: Application.get_env(:riichi_advanced, :valkey_pool_size, 5)

  defp valkey_url, do: System.get_env("VALKEY_URL", "redis://localhost:6379")
end
