FROM hugomods/hugo:latest AS builder
WORKDIR /src
COPY . .

RUN hugo --minify --baseURL "https://arcanecodex.dev/"

FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html

EXPOSE 80
