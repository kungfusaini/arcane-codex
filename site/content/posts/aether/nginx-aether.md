+++
date = '2025-11-26'
draft = false
title = 'Building Aether: Nginx Reverse Proxy'
categories = "Tech"
tags = ['Docker', 'Hosting', 'Web']
+++

The skeleton of my VPS setup is Nginx. It takes a collection of websites and applications, each with its own
way of deployment and brings them under a single umbrella. This is useful if you have multiple projects you
wish to host, but do not want the headache of remembering where each one is hosted and managing them individually. Not only does using Nginx save a lot of time and energy, but it's also a very safe solution. Let me
walk you through how and why I set this up. 

Note:
> If you are interested in learning more about the setup of my VPS {{< emph >}}Aether{{< /emph >}}, check out
> [this post](/content/posts/aether/building-aether.md). To see some code in action, see my [gateway service
> on GitHub](https://github.com/kungfusaini/aether/tree/main/services/gateway).

## Nginx: Reverse Proxy Wizardry

Nginx first emerged as a web server, with the purpose of delivering your website's files to external clients. In this original role, it is the digital courier. Without it, the client's attempts are unable to acquire the necessary components to render your site.

But it does not have to be just one website. In this case, you might want to set up Nginx as a {{< emph >}}reverse proxy.{{< /emph >}}. A reverse proxy is a server that acts as an intermediary between a user and one or more backend servers. What this means in practice is when you connect to a machine on the internet, Nginx acts as the {{< emph >}}gatekeeper{{< /emph >}}. To get to your websites or applications, all traffic must pass through
it. It's able to put certain restrictions and control the connection flow. 

For example, imagine I have two websites, `blog.com` and `webapplication.com`. I might want to host these websites on the
same computer, so I will make them resolve to the IP of that computer using DNS, for example
`143.243.12.32`. Now, when you type in either `blog.com` or `webapplication.com`, you will be routed to
`143.243.12.32`, and hit the Nginx instance. Now, based on which site you were trying to access, Nginx will
serve you the correct files, or route you to the port on which the web application is running, for example
`143.243.12.32:8080`. There are numerous benefits to this.

## Why Do This?

### Ease of Configuration
From the above example, we can see how configuration becomes much easier. Without Nginx acting as a reverse
proxy, we would have a much more complicated DNS setup. Instead of the target in the DNS console being just
the IP address of the machine we are serving from, we would have to configure the port as well, which makes
setup more fragile and tedious. If the port ever changes, we would also have to update our DNS records, which can lead to clients getting routed to an invalid gateway if we are still within the TTL window. 

Now, it's so easy to add another service. All I have to do is create a new DNS record that points to my VPS,
and add a new handler for that route in the main Nginx config. For example, `mail.sumeetsaini.com` routes to
my Mailcow instance, `vulkan.sumeetsaini.com` is my own personal API, `sumeetsaini.com` is my personal
website, and `arcanecodex.dev` is this blog. This is all managed by nginx, and it's so simple to modify the
routing to extend it as I please.

### Security
Instead of having all the above services available directly on the web, for outsiders, there is only a single
point they can connect to. So, instead of having security measures for every single service, causing duplication
of config and also increasing the attack surface, I can focus on having a single, hardened entry
point. This provides better security, as attackers have only one way to enter my citadel. I can introduce rate limiting, block malicious IPs, and filter requests before they reach my applications. If I want to have certain API endpoints only accessible from my website, for example, I can add the following Nginx config:

```nginx
add_header Access-Control-Allow-Origin "https://sumeetsaini.com" always;
```

Instead of wildcard `*`, I'm explicitly allowing only my domain, preventing other websites from making requests to my backend.

SSL certificates are important to establis a recognized and trusted web presence, but the management of these certificates on a per-domain basis can quickly become a tedious. By centralizing this process, Nginx handles all SSL termination, managing the issuance, renewal, and serving of certificates from a single, organized place for all the domains I wish to cover.

### Performance 
Nginx has a couple of performance boosting capabilities. When Nginx serves static content, it caches its responses, so that if another client requests the same information, it can serve them the cached files, improving response times. It can also perform load balancing. If one service becomes very popular, I can create a duplicate instance of it in the backend, and Nginx will handle routing evenly across both instances.

Finally, centralised logging provides unified access logs and monitoring for all services behind the proxy.
Instead of having to meticulously trawl through each service's log to find issues, I can see them all and filter
accordingly. This has saved me a lot of time when trying to debug issues.

## Conclusion

The reverse proxy architecture provided by Nginx transforms a chaotic collection of applications into a streamlined digital citadel, with a single, well-defended gate. No longer do you have to have web server config scattered around, and struggle to make changes, manage port conflicts and tedious DNS records. Your web presence is now unified, empowering you in this digital landscape.

Are you ready to weave this magic into your own infrastructure?

