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

const JOURNAL = `::: menu

- [Latest](#latest)
- [Series](#psalms-of-ascent)
- [Topics](#topics)

:::

::: collection

label: Featured
tag: featured
show: 1 newest
layout: hero
button: Read today's devotional

:::

:::: row

::: collection

title: Latest
show: 5 newest
layout: list

:::

::: topics

exclude: featured, psalms-of-ascent

New devotionals every Monday and Thursday, written by the pastoral staff.

:::

::::

::: collection

label: Series · read in order
title: Psalms of Ascent
tag: psalms-of-ascent
layout: series

The songs pilgrims sang on the road up to Jerusalem. Start at the bottom of the hill.

:::

::: footer

Still Water · Grace Hill Church

:::
`;

const PORTFOLIO = `::: menu

- [Work](#films-courses-and-campaigns)
- [Experience](#where-ive-worked)
- [Contact](#working-on-something-that-matters)

:::

::: hero

![portrait · behind the camera](placeholder)

Communications director · Teacher · Filmmaker

# Helping the church tell the truth well

I lead communications at Cornerstone Fellowship in Tulsa and teach media at Harbor Seminary. Twelve years of films, campaigns and classrooms.

[See the work](#films-courses-and-campaigns) [Résumé (PDF)](https://example.com/resume.pdf)

:::

:::: row

::: columns

Summary

## Announcements into testimony

Most church communication is announcements. I try to make it testimony. My team of four handles Sunday media, the weekly email and every story Cornerstone tells, and I bring what we learn back into the classroom, where future pastors practice interviewing, editing and telling the truth without spin.

:::

::: stats

- **Story** Documentary, interviewing, podcasting
- **Systems** Brand identity, email strategy
- **People** Volunteer training, teaching
- **Tools** Premiere, Resolve

:::

::::

::: collection

label: Work
title: Films, courses and campaigns
tag: work
show: 6 newest

:::

::: timeline

Experience

## Where I've worked

- **2021** Director of Communications, Cornerstone Fellowship. _Lead a team of four across Sunday media, email, social and print_
- **2019** Adjunct Instructor, Harbor Seminary. _Teach Storytelling for the Local Church to about 30 students a year_
- **2016** Media Producer, Northside Church. _200+ short films, the church's first podcast, a volunteer crew of 25_
- **2013** Staff Photographer, Lakeland Tribune. _Daily news and features; learned to find the story in forty minutes_

:::

::: cta

## Working on something that matters?

I take two outside projects a year for churches and ministries. Now booking spring 2027.

[Email me](mailto:you@example.com) [Download my résumé](https://example.com/resume.pdf)

:::

::: footer

© 2026 Maya Brooks · you@example.com

:::
`;

const EVENT = `::: menu

- [Schedule](#the-day)
- [Getting there](#getting-there)
- [RSVP](#save-your-seat)

:::

::: hero

![last year's workshop · filming in pairs](placeholder)

One-day workshop · Free for church staff and volunteers

# Tell Your Church's Story

A hands-on Saturday on testimony, interviewing and phone video. Bring a story from your congregation; leave with a finished two-minute film.

[RSVP by email](mailto:you@example.com?subject=RSVP) [Add to calendar](https://example.com/event.ics)

:::

::: stats

- **When** Sat, Nov 14 · 9 a.m. to 3 p.m.
- **Where** Harbor Seminary, Room 204
- **Cost** Free, lunch included

:::

::: callout

**28 of 40 seats taken.** Reply by Friday, Nov 6 with your name and church. Lunch is provided, so tell us about any allergies.

:::

::: timeline

Schedule

## The day

- **9:00** Coffee and introductions. _Bring the story you want to tell. One sentence is enough_
- **9:30** What makes a testimony true. _Maya Brooks on specificity, restraint and letting people sound like themselves_
- **10:30** Interviewing in pairs. _Practice the one-question interview with a partner. Phones only_
- **12:00** Lunch. _In the commons, with vegetarian and gluten-free options_
- **1:00** Cutting to two minutes. _Sam Whitaker walks through a free phone editor, step by step_
- **2:30** Screening. _We watch everyone's film together. Nobody has to show theirs_

:::

::: cards

## Leading the day

### Maya Brooks

Communications at Cornerstone. Teaches Storytelling for the Local Church at Harbor Seminary.

### Sam Whitaker

Filmmaker. Has shot more than 200 church films, most of them on a phone.

### Rev. Ruth Adeyemi

Pastor at Grace Hill. Will share how her church began telling one member story a month.

:::

## Getting there

![map · links to your maps app](placeholder)

**Harbor Seminary**, 1400 S. Lewis Ave, Tulsa. Park in Lot C; Room 204 is up the stairs past the library. [Open in Maps →](https://maps.example.com)

::: cards

## Good to know

### What does it cost?

Nothing for church staff and volunteers. Lunch is included.

### What should I bring?

A charged phone, earbuds with a mic, and one person's story in mind.

### I've never edited video.

Most people haven't. The afternoon assumes no experience.

### Can I bring my team?

Yes, up to four from one church. Include their names in your email.

:::

::: cta

## Save your seat

Email your name and church. You'll get a confirmation and a prep sheet within a day.

[RSVP by email](mailto:you@example.com?subject=RSVP) [Download .ics](https://example.com/event.ics)

:::

::: footer

Questions? you@example.com

:::
`;

const PROJECT = `::: menu

- [Outcomes](#what-changed)
- [Team](#team)
- [Deliverables](#deliverables)

:::

::: hero

![volunteers at the food pantry · launch week](placeholder)

Project review · January to April 2026

# Serve Tulsa: a place for everyone to help

We replaced clipboards, three spreadsheets and a lot of guilt with one page where 2,000 people can find a way to serve in under a minute.

[Open the live site](https://example.com) [Final report](https://example.com/report.pdf)

:::

::: cards

Outcomes · first 90 days

## What changed

### 412

People signed up to serve, up from 150 the previous spring.

### 9 days

To fill every Easter volunteer shift.

### 38%

Of new sign-ups were members of less than a year.

### 0

Paper cards left in the lobby.

:::

::: columns

### The problem

Serving meant finding the right staff member, filling out a paper card and waiting. Half of the cards were never followed up. New members told us they wanted to help but didn't know how to start.

### What we built

One page listing every open role, with the time it takes, who leads it and what to expect on the first day. Each ministry leader owns their own listing and gets a text when someone signs up.

:::

::: cards

## Gallery

### The serve page on a phone

![the serve page on a phone](placeholder)

### The lobby kiosk

![lobby kiosk](placeholder)

### A leader's text alert

![leader text alert](placeholder)

:::

::: timeline

Milestones

## Sixteen weeks, start to launch

- **Jan 6** Listening. _Twenty-two interviews with ministry leaders and new members about how serving actually starts_
- **Jan 27** One page, not an app. _Leaders edit their own listings, so it stays current_
- **Feb 17** Pilot at the 9 a.m. service. _Three ministries, a lobby kiosk and a QR code in the bulletin: 61 sign-ups in two weeks_
- **Mar 16** Every ministry listed. _Thirty-four roles live, each with a time commitment, a leader and a first-day note_
- **Apr 20** Launch Sunday. _Announced from the stage at all services with a two-minute film_

:::

::: cards

## Team

### Maya Brooks

Project lead, communications

### Daniel Ortiz

Pastor of Serving

### Priya Nair

Web and Ledgr setup

### Sam Whitaker

Film and photography

:::

::: cards

## Deliverables

### [Serve Tulsa, the live site](https://example.com)

The published page, with all 34 roles.

### [Final report (12 pages)](https://example.com/report.pdf)

Research, decisions, results and what we'd change.

### [Launch Sunday film · 2:04](https://example.com/film)

The announcement film shown at all services.

### [Ministry leader handbook](https://example.com/handbook)

How to write a listing and respond within 48 hours.

:::

::: footer

Written up by Maya Brooks · April 2026

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
  {
    id: "journal",
    name: "Journal",
    description:
      "A devotional or blog site: a featured piece up top, the latest list, topics with counts, and a series read in order. Publish your devotionals or posts to it, and tag them featured or with a series tag to fill those spots.",
    design: { language: "editorial", palette: "dusk", font: "serif" },
    body: JOURNAL,
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description:
      "A résumé with your work: who you are, a summary and skills, a Work collection where each piece gets its own page (add a video or link to it), an experience timeline, and a way to hire you. Publish items tagged work to fill it.",
    design: { language: "modern", palette: "slate", font: "public" },
    body: PORTFOLIO,
  },
  {
    id: "event",
    name: "Event",
    description:
      "A seminar, party or gathering on one page: when and where up front, RSVP as plain links (email, calendar, or an outside ticket page), the schedule, who's leading, getting there, and questions people ask.",
    design: { language: "warm", palette: "tide", font: "figtree" },
    body: EVENT,
  },
  {
    id: "project",
    name: "Project",
    description:
      "A finished project written up for review: the headline, outcome numbers, the problem and what you built, pictures, milestones, the team, and links to what you delivered.",
    design: { language: "bold", palette: "navy", font: "montserrat" },
    body: PROJECT,
  },
];

export function starterById(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}
