# Development workspace container — Node + PHP + Composer + git in one place,
# networked like `mcp` (wp_net + data_net + render_net) so code written here
# can be tested against the real sandboxes without leaving the container.
#
# This is a workspace, not a service: docker-compose.yml keeps it alive with
# `tail -f`, and work happens via `docker compose exec dev <command>`.

FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    php-cli \
    php-mbstring \
    php-xml \
    php-curl \
    php-zip \
    php-mysql \
    git \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

WORKDIR /workspace

CMD ["tail", "-f", "/dev/null"]
