+++
date = '2025-01-04'
draft = false
title = 'The Right Model'
categories = "Tech"
tags = ['AI','Coding Agents', 'LLM']
+++

There is seemingly and endless stream of AI models to choose from. Not only is the choice overwhelming, but I was constantly left with the thought I'm missing out on some super model that would make me more efficient, but as someone with inertia to change when it comes to certain things, I had put off experimenting. But, I eventually did run some test. I defined 4 of my main coding styles , and tried to find the best models for each.

The categories are:
- Daily Driver
- Super Fast
- Smart
- Reasoning

Let's see which models performed best!

Note:
| I am using [opencode](opencode.ai) as my AI tool of choice, and all testing has been performed in that enviroment. Your mileage may vary!

## Daily Driver - Qwen3Coder/BigPickle
For something to be a daily driver, it needs to be relatively cheap to run, fast, and capable. It should be able to complete moderately complex tasks in a  more {{< emph >}}vibey{{< /emph >}} style. "Hey make sure that the carousel image doesn't go out of bounds on mobile and that when I click it, it opens the product page" is a good example. It's not too complex of a task but still requires so understanding of the codebase to implement. The model should be able to interpret my vague prompt, so that there is little friction between thought and code. 

There are two models that really shine for me in this category. {{< emph >}}Qwen3 Coder 480B{{< /emph >}} is not only cheap, but is able to implement such features pretty fast and relatively bug free. It can perform several of these tasks in a row before having to reset the context window.

Another great model is BigPickle. Currently with opencode it's free. This was my workhorse before I decided to switch to Qwen3. It performs almost as well as Qwen3, but I have noticed it hallucinates more and gets stuck in loops more. It  sometimes disrespects the existing code for example, creating lots of duplicate CSS classes, but hey, it's free! If you pay attention to what the model is doing, Big Pickle is a great place to start.

## Speed - Grok Code Fast 1

Sometimes you don't want to have to wait for a model to think and the execute. When doing very small changes (which you are too lazy to do yourself) such as styling or rearranging UI elements, or asking small questions about the code, it feels good to get instant replies so you can move quickly. For this, Grok Code Fast 1 is the champion.

It's blazing fast, and is great when you want to test out little things quickly. It does have trouble when the context window gets too large or you ask too complex of a task from it. Keep it {{< emph >}}simple{{< /emph >}}, and this is a great little runner.

## Smart - Gemini 3 Pro

Sometimes your daily driver just doesn't cut it. It makes a mess of a feature you are trying to implement, can't grasp the requirements, or doesn't really understand the codebase. This is when you need to pull out the heavy hitters. 
Many people would turn to Claude in this instance, but it can be quite expensive. I much prefer Gemini 3 Pro. 

I have found that it's reasoning skills are top tier and it does a great job of implementing those more difficult features. Although you'd want to keep the context window below 200k tokens to pay the cheaper rate, it's total context window limit is 1M tokens, so you can keep it standby as your {{< emph >}}codebase expert{{< /emph >}}.

Another huge benefit it has is vision. You can show a screenshot of your code which is amazing for fronted debugging. But sometimes even such a great model has issues with those deep rooted bugs.

## Reasoning - Kimi K2 Thinking
What is the difference between the smart model and the reasoning? {{< emph >}}Time to think.{{< /emph >}}

Kimi K2 is really like a detective which you employ when you have a really nasty bug, race condition or memory leak which other models don't catch. Caveat, it's {{< emph >}}slow{{< /emph >}}, but that's not a bad thing in this context. It will spend time deeply thinking about the problem you have presented it with, reading the code and debating different solutions which are usually very thoughtful and something you might never have found. 

Sometimes the trail goes cold, and you'll be upset you sat there for 10 minutes for nothing, but it's worth it for the potential upside.

## The Model Matters
Your choice of model directly impacts your workflow. Just like members on a dev team have certain quirks, strengths and weaknesses, so do AI models and to be a effective modern programmer you must be able to choose the right model for the job.

