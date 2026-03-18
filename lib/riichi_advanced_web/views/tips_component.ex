defmodule RiichiAdvancedWeb.TipsComponent do
  use RiichiAdvancedWeb, :live_component
  import RiichiAdvancedWeb.Translations

  def mount(socket) do
    {:ok, socket}
  end

  def render(assigns) do
    ~H"""
    <div class="tips-component">
      <%= if @root_pid != nil do %>
        <%= t(@lang, "Post with #builder_mahjong!") %>
      <%= end %>
    </div>
    """
  end
end
