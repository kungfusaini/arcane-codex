+++
date = '2025-11-18'
draft = false
title = 'The Anatomy of AI Agents'
categories = "Tech"
tags = ['AI','AI Agents', 'LLM']
+++

Although the availability of LLMs has made our lives easier, they are still very limited. They only have the
ability to take some input text and spit out something that resembles human intelligence. They live in a
void and have no power outside of the current and immediate interaction you have with them. But this is
changing.

AI agents are the next step forward. An agent can be thought of as more {{< emph >}}alive{{< /emph >}} than a
mere LLM. They can remember, create and follow better plans, and act on the world around them. 

In [Google's AI Agents course](https://www.kaggle.com/learn-guide/5-day-agents), one principle stood out 
amongst the rest: Agentic systems are only as good as their architecture. 

Let's take a look at the anatomy of a well-constructed multi-agent system, mostly in the context of [Google's Agent
Development Kit (ADK)](https://google.github.io/adk-docs/).

(If you are interested in seeing detailed notes and code examples from the course, check out this [Github
repo](https://github.com/kungfusaini/google-ai-agents-course).

## The Body

LLMs are, in some ways, {{< emph >}}limitless{{< /emph >}}. They can fill any conceptual role in a
conversation and report on how they would solve any problem (even if they cannot conduct their plan).
But with so much potential comes issues. LLMs get confused, make things up, and don't do what you ask them to.
Sometimes simple instructions get ignored, which leads to frustration. Although agents give LLMs abilities, one
of their main benefits is the constraints they put on the LLMs. By carefully defining the type of agent and
its role, we pigeonhole the LLM, which makes it perform better at its specific task. Much like Marshall
McLuhan said {{< emph >}}"Where the whole man is involved, there is no work. Work begins with the division of labour"{{< /emph >}}.

To achieve this division of labour, however, agents need to be able to interact with other agents.
This can be done with sub-agents or the A2A protocol (which we will talk about later). A sub-agent is simply used by another agent to complete a task, but there are multiple ways to use them, depending on the type of agent. Google's ADK allows for the definition of a few types of agents.

### Types of Agents
- Sequential Agents: Sequential agents use sub-agents in a specific order, for example, first a research
  agent, a summary agent and an editor agent. The process is baked into the agent itself
- Parallel Agents: These can run multiple sub-agents simultaneously. Multiple research agents, for example, don't need to run sequentially as their tasks are not dependent on each other
- Loop Agents: Loop agents, as the name suggests, run sub-agents in a loop. You could have a writer and an editor
  The agent runs in a loop until the editor agent is satisfied with the quality of the writer's output.

But how do these agents interact with the world, or indeed other agents?

## The Hands

In order to actually create change, agents have two main methods at their disposal.

Firstly, tools. Tools can be thought of as concrete, deterministic actions, essentially function calls. They
can be custom-defined for the agent, but it's also possible to use existing tools as well. Think of database
interactions, web search, or even editing local files. This is all done via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

Agents can also use other agents as tools. When describing the use of sub-agents above, this is essentially
using another agent as a tool. These other agents may be defined locally, but could also be external or
remote. To make sure that agents can communicate with each other, regardless of platform or framework,
the [Agent2Agent (A2A)](https://a2a-protocol.org/) protocol was created.

### A2A

The A2A protocol is a standard for inter-agent communication. In this system, every agent has an **agent
card**, which can be thought of as a business card, containing the agent's information and interaction details.

```python
public_agent_card = AgentCard(
    name='Hello World Agent',
    description='Just a hello world agent',
    url='http://localhost:9999/',
    version='1.0.0',
    default_input_modes=['text'],
    default_output_modes=['text'],
    skills=[google-search],
)
```

Other agents can ingest this card, and when in a multi-agent system, they can discover,
understand and interact with their peers.

A note on safety:
> If an agent is authorised to use other agents and tools to achieve its goals, it needs
> to be some kind of safety mechanisms involved so that the agent does not go rogue and make very expensive
> decisions. This can be done by putting explicit limits on the tools themselves, so agents are unable to cause too
> much damage, forcing the agent to communicate with a human for specific tool calls (Human in the Loop,
> HITL), or have the agent first create a detailed plan and then get another LLM to check it (known as the
> LLM as a judge pattern)


## The Mind: Context and Memory
Giving an agent a task, a role, and an idea of the available tools are all components of the agents 
{{< emph >}}context{{< /emph >}}. This information is stuffed into a context window, which is essentially the
only immediate information fed to the LLM at runtime. Every time you send a message to an agent, the context is
passed into it. Without context, LLM would be in their default state, being {{< emph >}}stateless{{< /emph>}}.

This introduces a challenge. While it might seem tempting to put any new information into the context window,
in practice, we must be more nuanced. If a context window is too large, we often see two negative reactions. One
is that LLM calls become more and more expensive, as we are feeding more tokens into the LLM on every call.
The other is known as {{< emph >}}context rot{{< /emph >}}. 

### Context Rot
It has been observed that as the context window increases in size, the LLM's performance degrades. If the
context window contains so much information, how does the LLM know what is more important? Vital details could
get buried in the context window, which could cause the agent to fail on simple tasks. On the flip side, the
chance of {{< emph >}}context poisoning {{< /emph >}} increases (when a piece of bad information is picked up
on and disproportionately affects the LLM). The model can show a bias for information at the beginning or end of the context, and hallucinations also seem
to increase as the context window gets larger. To combat this, the art of {{< emph >}}context
engineering{{< /emph >}} is employed.

### Context Engineering
There are a few techniques to ensure that context is managed correctly. It is inefficient to store every
single interaction between user and agent in the context window after, let's say, 10 messages. As long as the
LLM remembers the gist of the conversation and a few key details; the user will have the same experience. The
current context can be passed to another agent, who will summarise the conversation to date. This would apply
to all tool calls, inputs, outputs and interaction with other agents, keeping the context window concise while
retaining the important information. 

Another technique is to utilise a permanent, searchable memory. If just using context to remember conversations,
everything needs to be included. If, however, there is a fixed location (like an SQL database) in which key
interactions or information are stored, the agent can then look up information as it requires it. In the
correct terminology, {{< emph >}}sessions{{< /emph >}} are the current conversation and {{< emph >}}memory{{< /emph >}} is this out-of-context lookup. Another key benefit of memory is that it persists between sessions, so core information will be stored indefinitely.

## The Oversight: Observability
The final key pillar of a robust agentic system is observability. In traditional software engineering, if code
passes tests, then you can be confident that the code will always perform well (as long as the tests are well
written, of course). This is not the case with agents. An agent can pass all tests but then fail
when re-running them. This is because agents are {{< emph >}}non-deterministic{{< /emph >}}. Although our
architecture can lead to more determinism (like defining the order of sub-agent usage), we need to be able to
see exactly what the agent is doing and why.

This is where the [OpenTelemetry](https://opentelemetry.io/) framework can assist. We get three key insights
into the agent when using this.

- Traces: seeing the LLM's chain of reasoning and action to trace its steps
- Metrics: quantitative measures of the system's performance (latency, cost, etc.)
- Logs: a record of specific events, useful for seeing prompts and responses

Now, if an agent makes an incorrect decision, we can see {{< emph >}}why{{< /emph >}} it decided to do so,
which is truly invaluable information. The agent can now be tweaked with precision rather than with blind
adjustments. 

## Final Thoughts

With these key principles understood, one can now create truly intelligent systems.  We have equipped what was simply an isolated LLM with the
ability to act in the world with rationality and independence. The key lesson remains: architecture is fundamental to these systems' performance. Now, we can start to move beyond simple prompts. 

The future of AI looks bright for those who can grasp and implement these teachings.

