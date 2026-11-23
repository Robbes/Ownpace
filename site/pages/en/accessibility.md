# Accessibility statement

Ownpace should work for everyone who uses it, also with a screen reader, with a keyboard alone,
at high magnification or on a phone. This page says how far we are, what we know does not work
well yet, and how to tell us when something stands in your way.

**Last reviewed:** 2026-11-23

## What this statement covers {#scope}

- This website, www.ownpace.eu, in English and in Dutch.
- The Ownpace app at app.ownpace.eu, including the pages a link opens without signing in: the
  page where you give access to an account, and the page that shows a migration's progress.
- The self-hosted Ownpace appliance shows the same app screens on your own computer. What this
  page says about the app holds for those screens too.

Some pages you pass through are not ours: the sign-in page of our sign-in service, and the
consent screens of Google, Microsoft and Dropbox. We cannot change them. If one of them stops
you, tell us anyway, and we will look for another way with you.

## The standard we aim for {#standard}

We aim for the Web Content Accessibility Guidelines, **WCAG 2.2, level AA**. We say *aim for* on
purpose: the site and the app do not yet meet it in full (see *Known gaps*), and no independent
audit has been done. Everything below is what we checked ourselves.

## What we have done {#done}

Between September and November 2026 we worked through the app with phones and screen readers in
mind. The phone menu takes the keyboard's focus and gives it back, each step of *Start a
migration* opens at its top with focus on its heading, errors and waiting messages are
announced, a greyed-out button says in words why it cannot be pressed, and a *Skip to content*
link comes first on every page. Our automated tests open the sign-in pages, the migrations list,
every step of *Start a migration* and the links you receive at a phone's width, and fail when one
of them scrolls sideways.

In October 2026 we looked at every screen of the app and every page of this site, in English and
in Dutch, on a phone and on a desktop, and ran an automated accessibility checker (axe) on the
app in English and on every page of the site. It found text with too little contrast, links told
apart by colour alone and link names that did not match their words. We fixed those, and when
we checked again it found no serious or critical problems on the pages it read.

## Known gaps {#gaps}

These are the problems we know of and have not fixed yet:

- **A new screen is not announced.** When you follow a link to another screen in the app, the
  screen's title changes, but the keyboard's focus is not moved to the new screen. A screen
  reader does not say that a new screen opened, and you have to find its content yourself. The
  steps of *Start a migration* are the exception.
- **Some help only appears when you hover with a mouse.** On the *Check* screen, the short
  explanation of each result (what *Passed*, *Not checked* or *Could not be checked* means, and
  how much of the content was compared) is a hover text. On a phone, with a keyboard alone or with a
  screen reader you may not be able to read it. Elsewhere in the app a few more explanations sit
  in hover texts; we have not yet gone through all of them.

## What we have not checked yet {#not-checked}

- We have not yet used the app from start to finish with VoiceOver on an iPhone or TalkBack on
  an Android phone, nor at 200% zoom.
- We have not yet tried every app that opens links in its own browser, such as a mail or chat
  app. Some of them may block the window in which you sign in to Google.
- Our automated tests do not yet run an accessibility checker on every change, and they run in
  one browser engine (Chromium) only, not in Safari's. A problem we fixed can come back without
  a test noticing.

## Tell us about a barrier {#contact}

If something on this site or in the app stops you, or you need it in another form, write to
**support@ownpace.eu**. Say which page you were on and what you were trying to do; please never
send a password. A person reads what arrives there, and we aim to answer within five working
days.
