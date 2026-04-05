+++
date = '2026-04-05'
draft = false
title = 'Markdown Rendering Issue in Neovim'
categories = "Tech"
tags = ['Neovim','Debugging','Treesitter']
+++

This morning I spent a few hours debugging an issue where Neovim would throw errors every time I opened a Markdown file with code blocks. The error message was:
```
attempt to call method 'range' (a nil value)
```

Markdown in nvim is essential to my workflow, so I had to figure the issues out!

## The Problem

The error message wasn't particularly helpful at first glance. "attempt to call method 'range' (a nil value)" doesn't exactly tell you where to look. But after some digging, I realized this was breaking my render-markdown.nvim plugin.

Note:
> If you're having similar issues, the error might be hiding in your :messages buffer.

## Root Cause

After some research, here's what I found:

Neovim 0.12 was released a few weeks ago with major changes to its treesitter API. For those who don't know, treesitter is what handles syntax highlighting in Neovim. It's what makes your code look pretty.

The issue was that nvim-treesitter, the main treesitter plugin, has two versions:

1. master branch - for Neovim 0.11 (now archived)
2. main branch - rewritten for Neovim 0.12 (new)

It seems like there was some major drama in the discussions on the treesitter repo around this time causing the split. 

> Please be grateful and kind to opensource contributors. They dedicate their time towards so you can have free software.

Our system was still using the old master branch, which isn't compatible with Neovim 0.12.

## The Fix

The fix was simple once I understood the issue. I updated nvim-treesitter to use the main branch, updated the configuration to use the new API (slightly different syntax), and then updated the parsers via :TSUpdate.

Note:
> Always check your plugin versions when upgrading Neovim major versions.
> The lazy.nvim branch parameter can save you a lot of headache.

When using Neovim 0.12, you need to specify branch = "main" in your plugin configuration:

```lua
return {
  "nvim-treesitter/nvim-treesitter",
  branch = "main",  -- This is critical for Neovim 0.12!
  build = ":TSUpdate",
  lazy = false,
  config = function()
    require("nvim-treesitter").setup({...})
  end
}
```

## Key Takeaway

The maintainers made a complete rewrite with a different API. This caught me off guard because in my experience, plugin updates are usually backward compatible. But with major Neovim releases, sometimes they aren't.

Everything is now working:

- No more errors on Markdown files with code blocks
- render-markdown.nvim is fully functional
- All treesitter highlighting works as expected

The lesson here is to always double-check your plugin configurations when upgrading your tools. Sometimes the old reliable stuff just doesn't work anymore.
