'use client'
// app/components/xtell/SectionBoundary.tsx — keeps a failure inside one
// section of the street (owner, Sep 28: each section loads on its own). A
// section that throws, on the server or in the browser, shows `fallback`
// in its place; the rest of the page is untouched.

import { Component, type ReactNode } from 'react'

export default class SectionBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { console.warn('[xtell] a section failed:', error) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
