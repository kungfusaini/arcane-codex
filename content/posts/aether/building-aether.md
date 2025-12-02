+++
date = '2025-11-21'
draft = false
title = 'Building Aether: Hosting a Personal Corner of the Internet'
categories = "Tech"
tags = ['Docker','CI/CD', 'Hosting', 'Web']
+++

It is often told that every serious developer should have their own space on the web. A space to express
themselves, share their learning and host all their personal projects.

I felt that I was lacking a digital form of expression, so I decided to embark on a journey. I built {{< emph >}}Aether{{< /emph >}}. This is a framework for hosting my personal website, this blog, an email service and my own API.

In order to have maximum control, I decided to build this infrastructure myself. I learned a lot along the way, and this post details the philosophy and high-level implementation details. 

Note:
> This post is an overview of the project, and will be updated to link to future posts, which will dive deeper into
> further aspects of the project.

### Why Build Your Own Infrastructure?

Having the freedom to set up your services as you wish is the main advantage of this do-it-yourself approach.
Full control is important because it lets you endlessly tweak things to your liking without being beholden
to the options given by third-party solutions. 

You also build a foundation of projects to come. I wanted a contact form on my website that would send an
email of the details to my inbox, and I was able to implement this. Should I want more options, like let's say
to create a To-Do list item to reply to the email whenever I receive a new contact message, I could do so. I am
in control, and I can make things exactly as I see fit, no compromises.

I have found that having my own digital infrastructure makes me more creative and productive. Just as you can
imagine, having a blog makes you feel like writing more, and having your own
digital infrastructure makes you want to create more in general. As James Clear says in Atomic Habits
{{< emph >}}"Reducing the friction associated with good behaviours makes them easier to perform..."{{< /emph >}}

Another benefit is cost. If you build your own infrastructure, you only need to pay for access to a VPS (which
costs around $7 a month in my case).

One cannot overlook learning. Often, developers are far removed from the technology they actually work on. That can be good as it allows for hyper-specialisation, but the internet and APIs are what the whole world runs on, so it's important to know how it actually all ties together, and what better way than to contribute to that infrastructure yourself. The {{< emph >}}Arcane Codex{{< /emph >}} philosophy emphasises mastery and knowledge of your tools.

## Aether: Architecture Overview

There are a few services that constitute {{< emph >}}Aether{{< /emph >}}:
- This Blog: Powered by Hugo
- Personal Website: A place to share some things about me and links to what I'm currently working on. Built using `Three.js`
- Mailcow: Used for hosting a private mail server. 
- Vulkan: Personal API, with built-in mail handling, and service monitoring for the other services.

More details about these components will be added in the future, so you can read more. 

All of these modules are then tied together by `Nginx`.

### Nginx: Reverse Proxy

Instead of having these services on publicly exposed ports, they are running on an internal network, and `Nginx` has been set up as a reverse proxy. What this means in practice is that external connections hit a single port on my VPS, which is managed by `Nginx`. It then acts as the {{< emph >}}gatekeeper{{< /emph >}}, routing the connection to the correct services. This makes it much easier to configure the networking for all services in one place and allows for the quick addition of new services. 

Note:
> If traffic ever gets too large on these sites, this approach might need some additional consideration.
> Although Nginx does have load-balancing built in, I am unsure if it would be sufficient for the large scale.
> Food for thought.

Edit:
> To read more about the Nginx setup, check out [this blog
> post](https://arcanecodex.dev/posts/aether/nginx-aether/)

## The Development/Deployment Lifecycle

It was very important to me to have as efficient and automated a deployment cycle as possible. I experimented with various approaches to manually deploying on the VPS, but ran into two main issues. 

1. Using scripts was fragile and error-prone
2. There was a disconnect between the production and dev environments. Having a unified setup was
   tricky. 

Because of these reasons, I decided to use {{< emph >}}Docker{{< /emph >}}. 

### Unified Under Docker

Dockerising the services in the project was a great step in the right direction. Firstly, the use of
`docker-compose-prod.yml` and `docker-compose-dev.yml` files makes it very easy to contain all environment-specific configuration in a single location, meaning that the actual code for each service could remain the
same in prod and dev. All that would need to change is the Docker file being used to spin up the containers.
I could then also have a {{< emph >}}Aether{{< /emph >}} as an overarching container/service manager as well as
injecting finer-grained container management for each service. 

Docker also allowed me to use the fantastic GitHub package services, along with GitHub Actions.

### GitHub Packages and Actions: Automated Deployment

GitHub Packages is a service that allows for the building and hosting of Docker containers. This, combined with
GitHub Actions allows for a very powerful pipeline. Whenever new code is pushed, GitHub actions are triggered
in the {{< emph >}}Aether{{< /emph >}} repo. Firstly, the containers for each service are built and hosted on
GitHub, and then another action will update the containers used on the VPS. No code is actually being stored
on the VPS, just the updated Docker container. The containers are then restarted on the VPS. 

Code deployments are {{< emph >}}fast{{< /emph >}} and {{< emph >}}efficient{{< /emph >}}. There is almost no
downtime when pushing out new changes, and all deployments are also declarative, which means it is always
reproducible. 

## Closing Remarks

Aether isn’t just infrastructure. It’s a foundation for things to come and a place where I can experiment, share and build without restrictions. The tools are tuned to me.

I see now why it is told that every developer should have a corner of the web they truly own, not someone else’s terms. I hope I have inspired you to do the same. The world could do with a bit more expression.

