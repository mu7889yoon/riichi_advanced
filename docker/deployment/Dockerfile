# ============================================================
# Stage 1: Builder
# ============================================================
FROM elixir:1.17-otp-27 AS builder

ENV MIX_ENV=prod

# Install system dependencies
# git is required for GitHub dependencies (porcelain, diff_match_patch)
RUN apt-get update && apt-get install -y \
    build-essential \
    nodejs \
    npm \
    jq \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Hex and Rebar
RUN mix local.hex --force && mix local.rebar --force

# --- Cache-optimized layer structure ---

# 1. Dependencies: copy only mix files first for better caching
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mix deps.compile

# 2. Configuration
COPY config/ config/

# 3. Assets: npm install + asset pipeline
COPY assets/ assets/
RUN npm install --prefix assets
RUN mix assets.deploy

# 4. Application code: compile and release
COPY lib/ lib/
COPY priv/ priv/
RUN mix compile
RUN mix release

# ============================================================
# Stage 2: Runner
# ============================================================
FROM debian:bookworm-slim AS runner

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y \
    libstdc++6 \
    openssl \
    libncurses5 \
    locales \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Set locale
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# Create non-root user
RUN useradd --system --no-create-home app

WORKDIR /app

# Copy release from builder
COPY --from=builder /app/_build/prod/rel/riichi_advanced ./
COPY --from=builder /app/priv/static ./priv/static

# Set ownership and switch to non-root user
RUN chown -R app:app /app
USER app

CMD ["bin/riichi_advanced", "start"]
