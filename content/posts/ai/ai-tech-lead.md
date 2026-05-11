+++
date = '2026-05-11'
draft = false
title = 'AI Makes You Think Like a Tech Lead'
categories = "Tech"
tags = ['AI','Coding Agents', 'LLM']
+++

Over the last year or so, I've spent a crazy amount of time with coding agents. Tried all sorts of harnesses and models. Learned a lot of lessons, but one thing really stuck: using AI well means thinking like a tech lead.

## What Does a Tech Lead Actually Do?

Think about how a tech lead works. They're not sitting there writing code all day. Their job is deciding what work needs doing, how to do it, and when. They delegate and set standards.

People keep asking if AI is going to take their dev jobs. And yeah, if all you bring to the table is typing code, that's an issue. But here's the thing. You now have {{< emph >}}employees{{< /emph >}} that are dirt cheap and work faster than ever. It's no longer quick you can pump out code, it's about how well you direct the work.

There's this joke that tech leads sometimes can't write code that well. In the age of AI, it's probably true that AI can write better code than you. {{< emph >}}Lean into that.{{< /emph >}} Your job becomes architecture and quality control.

## Rules and Standards are King

If you've managed developers, you know clear standards are the difference between a codebase you can work with and a total disaster. Same deal with AI.

You need style guides. Explicit ones. Things you like, things you don't. Patterns to avoid. How you want PRs structured. All of it written down.

Better to be over descriptive than under. AI doesn't get offended by too much context. Tell it your conventions upfront. File structure preferences, naming conventions, testing requirements, how you handle errors. The more constraints you give it, the better the output. Have a standards file somewhere in your repo. 

## Planning is Key

Biggest mistake I see? Jumping straight into coding. You wouldn't do that with a team of devs. Don't do it with AI either.

Make a plan. Then another one. I use voice chat for this and it's incredible for discussing ideas back and forth. Don't stop refining until it's solid. Ask yourself a few times: what am I missing? You can even ask you coding agent to identify any gaps. 

Once the plan is good, let the agent rip through it. {{< emph >}}Do all the thinking upfront.{{< /emph >}} Plan down to what files to touch and what tests to write. Imagine you're the lead architect planning a big migration. It's the same thing.

## Simplicity is Essential

Complexity kills. I spent way too much time messing with AI agent frameworks. Nah. Listen to Jake Van Clief. He came up with ICM. The whole idea is folders instead of frameworks.

Numbered folders are your stages. Markdown files are your prompts. One agent reads the right files at the right time. That's it. You don't need a multi-agent system. You need a file tree.

Van Clief says configure the factory, not the product. Set your rules up once. Then just run it.

Keep it simple. The framework is a folder.

## You're the Lead Now

The devs who thrive won't be the best coders. They'll be the ones who best direct the code that gets written. Tech lead isn't a role you grow into after years anymore. It's the mindset you need right now.
