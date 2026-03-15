import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# Nebulex Redis adapter config (all environments)
valkey_url = System.get_env("VALKEY_URL", "redis://localhost:6379")

config :riichi_advanced, RiichiAdvanced.Cache,
  conn_opts: [
    url: valkey_url
  ]

if config_env() == :prod do
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  port = String.to_integer(System.get_env("HTTP_PORT") || "8080")
  host = System.get_env("PHX_HOST") || "localhost"

  config :riichi_advanced, RiichiAdvancedWeb.Endpoint,
    server: true,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0}, port: port],
    check_origin: [
      "https://#{host}",
      "//#{host}"
    ],
    secret_key_base: secret_key_base
end
