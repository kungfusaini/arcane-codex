+++
date = '2025-11-21'
draft = true
title = 'Building Aether: Hosting a Personal Corner of the Internet'
categories = "Tech"
tags = ['Docker','CI/CD', 'Hosting']
+++

It was once told to me that every seriois developer should have their own sapce on the wbe
a space to express themselelves, share their learning and host all the cool projets thye want to have
I decided to embark on this journey (building aether), hosting my personal website, this blog, an email service and my own api
I decided to build this infrastructure myself, but
this post details the philosophu and implementation

Note:
This post is an overview of prokect, and will be updated to linkt to future posts which will dive deeper into
further aspects of the project.

### Introduction — Why Build Your Own Infrastructure?

Independence

Cost control

Learning

The “Arcane Codex” philosophy of knowing your tools

## The Architecture Overview

Diagram of the full stack

List of services:
Hugo, Node API, Mailcow, Nginx, CI/CD, MariaDB

Why Docker everywhere

Why one VPS instead of Kubernetes

## Networking Philosophy

Internal networks vs exposed ports

Nginx as the single gatekeeper

High-Level Walkthrough of Each Component
This is only a summary, not deep technical detail.
(The details live in the later posts — preventing duplication.)

## The Deployment Lifecycle

Push → GHCR → VPS pull

Nginx reloads

Zero downtime explained briefly
(Deeper explanation in article #2.)

## Security Principles

Firewall

Fail2ban

SSL
(Only highlighted, not deep-dive.)

## Final Architecture Diagram + Takeaways

How This Differs From Others
