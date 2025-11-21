# Post Ideas

- [ ] ibm extreme blue hackathon
- [ ] ibm rogue wireless access point
- [ ] mako india project
- [ ] overwatch series

# VPS Series:

## Building a Production-Ready VPS From Scratch (Docker + Nginx + CI/CD)

Tone: Serious / flagship Technomancer post
Audience: Developers, DevOps beginners, indie hackers
Purpose: High-level architecture showcase

Outline

Introduction — Why Build Your Own Infrastructure?

Independence

Cost control

Learning

The “Arcane Codex” philosophy of knowing your tools

The Architecture Overview

Diagram of the full stack

List of services:
Hugo, Node API, Mailcow, Nginx, CI/CD, MariaDB

Why Docker everywhere

Why one VPS instead of Kubernetes

Networking Philosophy

Internal networks vs exposed ports

Nginx as the single gatekeeper

High-Level Walkthrough of Each Component
This is only a summary, not deep technical detail.
(The details live in the later posts — preventing duplication.)

The Deployment Lifecycle

Push → GHCR → VPS pull

Nginx reloads

Zero downtime explained briefly
(Deeper explanation in article #2.)

Security Principles

Firewall

Fail2ban

SSL
(Only highlighted, not deep-dive.)

Final Architecture Diagram + Takeaways

How This Differs From Others

This post gives the big picture.
It links to other posts for the details, but does not duplicate them.
Think “overview of the entire universe.”

## How I Built a Zero-Downtime CI/CD Pipeline Using GitHub Actions + Docker Compose

Tone: Practical, technical
Audience: DevOps engineers, indie hackers
Purpose: Deep dive into CI/CD specifically

Outline

The Problem: Manual Deployments Suck

The Architecture of the Pipeline

Diagram

GHCR registry

Multi-platform builds

GitHub Actions Workflow Explained

YAML structure

Secrets management

Build caching

Deploy Script on VPS

SSH

docker compose pull

container restart logic

How Zero-Downtime Works

Graceful restarts

Using docker-compose --detach

Healthchecks

Disaster Scenarios & Rollback Strategy

How This Differs

This is CI/CD-specific.
No discussion of Nginx, Mailcow, or architecture except where relevant.

## Architecting a Microservices Setup on a Single VPS

Tone: Technical, conceptual
Audience: Devs wanting to scale small projects
Purpose: Explain why and how you split services

Outline

Why Microservices on a Single Machine?

Separation of concerns

Easier deployments

Safer isolation

Networking Model

The internal Docker networks

Private communication between Node API + DB

Reverse Proxy Routing

Domain → service mapping

Service Design Philosophy

Hugo = static

Node API = dynamic

Mailcow = isolated

Scaling Patterns

How to add new services

When to split VPS

How to containerise future agents (fits your AI theme)

How This Differs

Does NOT talk about CI/CD, email, or Nginx configuration.
Focus is on service boundaries and architectural reasoning.

## Self-Hosting Email: SPF, DKIM, DMARC, and Mailcow

Tone: Technical but narrative (pain, pitfalls)
Audience: Self-hosters, sysadmins
Purpose: Email is a SEO goldmine topic

Outline

Why I Chose Mailcow

Control

Deliverability

Branding

How Email Works (for Humans)

Brief explanation

DNS Setup

SPF

DKIM

DMARC

PTR

Mailcow Setup

docker-compose

Certificates

Integration With Your API

SMTP

Transactional email

Deliverability Checklist

How This Differs

Zero overlap with CI/CD, microservices, or Nginx routing except a single line for context.
Entirely email-focused.

## Reverse Proxy Wizardry: My Modular Nginx Setup for Multi-Site Deployments

Tone: Technical, “wizardly”
Audience: Web engineers, sysadmins

Outline

Why Nginx Is the Gatekeeper

Modular Folder Structure (conf.d/)

Shared Security Headers

Routing to Multiple Services

Hugo

Node

Mailcow admin

SSL Strategy

Certbot

Wildcard certificates

Performance Tuning

How This Differs

This is ONLY Nginx.
No CI/CD, no mail, no philosophy.
Deep, tactical, config-heavy.

## Running Multi-Environment Docker Compose (Dev vs Prod)

Tone: Technical, practical
Audience: Developers building two setups
Purpose: Teach clean environment separation

Outline

Why You Need Two Environments

Dev Compose Setup

Volumes

Live reload

Raw logs

Fake email / Ethereal

Prod Compose Setup

GHCR images

Private network

Nginx

SSL

Mailcow real SMTP

Shared .env vs Separate .env.prod

Deployment Scripts

How This Differs

This is exclusively about compose orchestration and environment strategy.
Other posts might reference this, but the deep detail is here.

## Building My Personal Infrastructure: What I Learned Running My Own VPS

Tone: Light, personal — could be written by The Wanderer
Audience: Anyone curious
Purpose: Entertaining, brand-building

Outline

Why I Self-Host Instead of Using AWS

Choosing a VPS Provider

Breaking Everything (And Fixing It)

How Much It Costs

What I’d Do Differently Now

Advice for New Self-Hosters

How This Differs

Opinion + storytelling.
Not meant to rank for deep keywords.
Human entry point to your brand.

## The Anatomy of a Modern Node.js API

Tone: Serious technical breakdown
Audience: Back-end developers

Outline

Why Express?

Security Layers

Helmet

CORS

Validation

Rate limiting

Architecture

Routes

Controllers

Services

Integration With Mailcow SMTP

Error Handling & Observability

How This Differs

Laser-focused on the API layer only.
No talk of Docker, Nginx, or VPS-level architecture.

🎯 How They Differ (Summary Table)
Article	Focus	Overlap Avoidance
#1 Full VPS Build	High-level architecture	Links to others; doesn’t go deep
#2 CI/CD	Deployment pipeline	No Nginx/Mailcow specifics
#3 Microservices	Service boundaries	No CI/CD or Nginx config
#4 Mailcow/Email	Email deliverability	No deployment or routing
#5 Nginx Wizardry	Reverse proxy details	No services/CI/CD
#6 Compose Dev vs Prod	Environment separation	No email or proxy details
#7 Personal Lessons	Light storytelling	No technical details
#8 Node API	Backend design	No internal networks, no deployment
