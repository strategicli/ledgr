// Starter pages (explorations/website-pages.md, "Building a page by hand"): a new
// Website Page can begin filled with sample sections, so most people replace the
// words and pictures and never type a block. Each starter is ordinary markdown
// plus a suggested look; after it lands it is just the page's body, owned and
// edited like any note. Sample people and details are invented, and every
// `![…](placeholder)` shows a striped box captioned with the picture to add.
// Designs come from Claude Design (project "Ledgr Design System").
import type { Design } from "@/modules/website-pages/lib/theme";

export type Starter = { id: string; name: string; description: string; design: Design; body: string };

const PERSONAL_SITE = `::: menu

- [Work](#things-ive-made)
- [Writing](#writing)
- [Say hello](#say-hello)

:::

::: hero

![portrait · in the workshop](placeholder)

Youth pastor · Writer · Woodworker

# Small things, done slowly, for the people nearby

I'm Jonah. I'm a youth pastor in Kansas City. I write a monthly letter about ordinary faith, build furniture on Saturdays, and host a dinner for our street once a month.

[See what I'm working on](#things-ive-made) [Say hello](#say-hello)

:::

::: columns

A bit about me

### Work

Youth pastor at Redeemer Church for nine years. Mostly I listen to teenagers and drive a van.

### Write

A monthly letter about ordinary faith, read by about 3,000 people, and the odd essay elsewhere.

### Make

Furniture from salvaged wood, a yard dinner for the neighbors, and a very occasional podcast.

:::

::: collection

label: Work
title: Things I've made
tag: work
show: 6 newest

:::

:::: row

::: collection

title: Writing
tag: writing
show: 4 newest
layout: list

:::

::: timeline

## Now

- **Reading** Jayber Crow, Wendell Berry. _Second time through_
- **Building** A cedar bookshelf. _For the church youth room_
- **Learning** Spanish, badly. _Tuesday nights with a neighbor_

:::

::::

::: quotes

> Jonah's letter is the one email I read slowly. It makes the rest of the week feel less rushed.
>
> — Reader since 2021

> He started a dinner and now our street actually knows each other. My kids think it's a holiday.
>
> — Carla M. · Neighbor

:::

::: cta

## Say hello

I'm always glad to hear from readers, neighbors and anyone starting something similar. Email is best; a call works too.

[Email me](mailto:you@example.com) [Book a 20-min call](https://example.com/call)

:::

::: footer

you@example.com · Kansas City, MO

:::
`;

export const STARTERS: Starter[] = [
  {
    id: "personal-site",
    name: "Personal site",
    description:
      "Who you are, a Work collection where each piece gets its own page, a writing list, a Now section, kind words, and a way to say hello. Publish items tagged work or writing to fill the lists.",
    design: { language: "minimal", palette: "dusk", font: "public" },
    body: PERSONAL_SITE,
  },
];

export function starterById(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}
