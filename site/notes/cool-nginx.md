# Cool Nginx Snippets

This file contains interesting nginx configuration patterns and code snippets from the ArcaneCodex project, perfect for highlighting in blog posts about nginx wizardry.

---

## 1. CORS Configuration with Preflight Handling

**Snippet:**
```nginx
# CORS headers for cross-origin requests from sumeetsaini.com
location / {
    add_header Access-Control-Allow-Origin "https://sumeetsaini.com" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
    
    # Handle preflight OPTIONS requests
    if ($request_method = 'OPTIONS') {
        add_header Access-Control-Allow-Origin "https://sumeetsaini.com" always;
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        add_header Content-Length "0";
        add_header Content-Type "text/plain";
        return 204;
    }
}
```

**Why it's cool:** Shows proper CORS implementation with explicit preflight request handling - many developers miss the `OPTIONS` method handling. The `return 204` is the correct HTTP response for successful preflight requests.

**Source:** `nginx.conf:8-21`

---

## 2. Smart Gzip Configuration

**Snippet:**
```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

**Why it's cool:** The `gzip_min_length 1024` prevents compressing tiny files (which would actually increase size), and `gzip_vary on` adds the `Vary: Accept-Encoding` header for proper caching. You're specifying exactly which MIME types to compress instead of blindly compressing everything.

**Source:** `nginx.conf:27-30`

---

## 3. Multi-Stage Docker Build Pattern

**Snippet:**
```dockerfile
FROM hugomods/hugo:latest AS builder
WORKDIR /src
COPY . .
RUN hugo --minify --baseURL "https://arcanecodex.dev/"

FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

**Why it's cool:** Demonstrates clean separation between build and runtime - Hugo builds static files, then nginx serves them. The `--from=builder` pattern is a best practice for optimized container images that keeps final images small and secure.

**Source:** `Dockerfile.prod:1-9`

---

## 4. Specific Domain Whitelisting

**Snippet:**
```nginx
add_header Access-Control-Allow-Origin "https://sumeetsaini.com" always;
```

**Why it's cool:** Instead of wildcard `*`, you're explicitly allowing only your domain - better security practice for production APIs. This prevents other websites from making requests to your backend.

**Source:** `nginx.conf:9`

---

## 5. Development vs Production Container Strategy

**Snippet:**
```dockerfile
# Dev: Direct Hugo server
CMD ["hugo", "server", "--bind", "0.0.0.0", "--port", "1313", "--baseURL", "localhost", "--environment", "development", "--watch", "--buildDrafts", "--buildFuture"]

# Prod: Static nginx serving
FROM nginx:alpine
COPY --from=builder /src/public /usr/share/nginx/html
```

**Why it's cool:** Demonstrates dual-environment approach - dev uses live-reloading Hugo server, prod uses optimized static serving via nginx. This pattern is perfect for modern web development workflows.

**Source:** `Dockerfile.dev:12` and `Dockerfile.prod:7-8`

---

## 6. The "Gatekeeper" Architecture Pattern

**Snippet:**
> "Nginx has been set up as a reverse proxy. What this means in practice is that external connections hit a single port on my VPS, which is managed by Nginx. It then acts as the gatekeeper, routing the connection to the correct services."

**Why it's cool:** This is the modern microservices pattern on a single VPS - nginx as the central traffic coordinator, internal Docker networks for service isolation, and single public port exposure. Perfect for security and scalability.

**Source:** `content/posts/aether/building-aether.md:55`

---

## 7. Zero-Downtime Deployment Pattern

**Snippet:**
> "Code deployments are fast and efficient. There is almost no downtime when pushing out new changes, and all deployments are also declarative."

**Why it's cool:** The combination of Docker + nginx + GitHub Actions creates a zero-downtime pipeline where nginx can serve old content while new containers are being pulled and started. This is production-grade deployment strategy.

**Source:** `content/posts/aether/building-aether.md:90-92`

---

## 8. Content-Specific Gzip Optimization

**Snippet:**
```nginx
gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;
```

**Why it's cool:** You're not just enabling gzip blindly - you're specifying exactly which MIME types to compress. This shows understanding that compressing already-compressed files (like images) would be wasteful.

**Source:** `nginx.conf:30`

---

## 9. Preflight Request Handling

**Snippet:**
```nginx
if ($request_method = 'OPTIONS') {
    add_header Content-Length "0";
    add_header Content-Type "text/plain";
    return 204;
}
```

**Why it's cool:** Proper handling of CORS preflight requests with `Content-Length: 0` and `Content-Type: text/plain` headers, returning HTTP 204 (No Content) which is the standard response for successful preflight requests.

**Source:** `nginx.conf:14-20`

---

## 10. Static File Serving Configuration

**Snippet:**
```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;
    
    try_files $uri $uri/ =404;
}
```

**Why it's cool:** Clean, minimal static file serving configuration. The `try_files $uri $uri/ =404` pattern is nginx's efficient way to serve files directly, fall back to directories, and return 404 if nothing matches.

**Source:** `nginx.conf:1-5, 23`

---

## Summary

These snippets showcase a modern, security-conscious approach to web infrastructure that balances performance, security, and maintainability. They demonstrate:

- **Security-first thinking** (CORS whitelisting, preflight handling)
- **Performance optimization** (smart gzip, static serving)
- **Modern DevOps practices** (multi-stage builds, zero-downtime deployments)
- **Clean architecture** (gatekeeper pattern, environment separation)

Perfect content for technical blog posts about nginx wizardry and modern web infrastructure!