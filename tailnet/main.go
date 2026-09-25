// ledgr-tailnet: joins the owner's Tailscale network as its own machine and
// serves Ledgr there over HTTPS (the Tailscale module, ADR-276).
//
// The supervisor starts this the way it starts Postgres. It uses Tailscale's
// tsnet library, so it is a complete Tailscale node in one program: the
// computer needs no Tailscale app, and a system Tailscale that is already
// installed is left alone (this node has its own keys, its own name and no
// network adapter).
//
// What it does, and nothing more:
//   - keeps its Tailscale state (this node's keys) in -dir. Never logged.
//   - joins as -hostname. Until signed in, it reports the sign-in link.
//   - serves HTTPS on :443 of its tailnet name and forwards every request to
//     -target, which must be a loopback http address (the app).
//   - writes its state to -status as JSON: starting, needs-login (with the
//     link), running (with the address), or error (with a message).
//   - exits cleanly when stdin closes, so it cannot outlive the supervisor.
//   - with -logout, signs this node out of the tailnet and exits.
//
// ponytail: Funnel (step 5 of the install plan) is a second listener here,
// s.ListenFunnel("tcp", ":443"), behind a flag. Not built yet.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

type status struct {
	State   string `json:"state"`
	AuthURL string `json:"authUrl,omitempty"`
	DNSName string `json:"dnsName,omitempty"`
	URL     string `json:"url,omitempty"`
	Message string `json:"message,omitempty"`
	At      string `json:"at"`
}

var statusPath string

// writeStatus replaces the status file in one step (write, then rename), so
// the app never reads half a file.
func writeStatus(s status) {
	s.At = time.Now().UTC().Format(time.RFC3339)
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := statusPath + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		log.Printf("could not write status: %v", err)
		return
	}
	if err := os.Rename(tmp, statusPath); err != nil {
		log.Printf("could not write status: %v", err)
	}
}

// loopbackTarget accepts only http://127.0.0.1:<port>, http://localhost:<port>
// or http://[::1]:<port>. This program must never forward the tailnet to some
// other machine.
func loopbackTarget(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Port() == "" {
		return nil, fmt.Errorf("-target must look like http://127.0.0.1:3000, got %q", raw)
	}
	h := u.Hostname()
	if h == "localhost" {
		return u, nil
	}
	if ip := net.ParseIP(h); ip != nil && ip.IsLoopback() {
		return u, nil
	}
	return nil, fmt.Errorf("-target must be on this machine (127.0.0.1), got %q", raw)
}

func main() {
	dir := flag.String("dir", "", "folder for this node's Tailscale state (holds its keys)")
	hostname := flag.String("hostname", "", "machine name on the tailnet, e.g. ledgr-office-pc")
	target := flag.String("target", "", "the app's loopback address, e.g. http://127.0.0.1:3000")
	flag.StringVar(&statusPath, "status", "", "file to write this helper's status to (JSON)")
	logout := flag.Bool("logout", false, "sign this node out of the tailnet, then exit")
	verbose := flag.Bool("verbose", false, "print Tailscale's own detailed logs to stderr")
	flag.Parse()
	log.SetFlags(0)
	log.SetPrefix("ledgr-tailnet: ")

	if *dir == "" || *hostname == "" {
		log.Fatal("-dir and -hostname are required")
	}
	quiet := func(string, ...any) {}
	s := &tsnet.Server{Dir: *dir, Hostname: *hostname, Logf: quiet, UserLogf: quiet}
	if *verbose {
		s.Logf = log.Printf
	}

	if *logout {
		os.Exit(runLogout(s))
	}

	if statusPath == "" {
		log.Fatal("-status is required")
	}
	backend, err := loopbackTarget(*target)
	if err != nil {
		writeStatus(status{State: "error", Message: err.Error()})
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(statusPath), 0o700); err != nil {
		log.Fatal(err)
	}

	writeStatus(status{State: "starting"})
	if err := s.Start(); err != nil {
		writeStatus(status{State: "error", Message: "Tailscale could not start: " + err.Error()})
		log.Fatal(err)
	}
	lc, err := s.LocalClient()
	if err != nil {
		writeStatus(status{State: "error", Message: err.Error()})
		log.Fatal(err)
	}

	// The supervisor holds our stdin. When it closes it (a stop) or dies, this
	// read returns and we leave, so the helper can never be orphaned.
	ctx, stop := context.WithCancel(context.Background())
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		stop()
	}()

	code := serve(ctx, s, lc, backend)
	_ = s.Close()
	os.Exit(code)
}

func serve(ctx context.Context, s *tsnet.Server, lc *local.Client, backend *url.URL) int {
	// 1. Wait for sign-in, reporting the link while there is one.
	var domain string
	for domain == "" {
		st, err := lc.StatusWithoutPeers(ctx)
		switch {
		case ctx.Err() != nil:
			return 0
		case err != nil:
			writeStatus(status{State: "starting", Message: err.Error()})
		case st.BackendState == "Running" && st.Self != nil:
			domain = strings.TrimSuffix(st.Self.DNSName, ".")
		case st.AuthURL != "":
			writeStatus(status{State: "needs-login", AuthURL: st.AuthURL})
		default:
			writeStatus(status{State: "starting", Message: st.BackendState})
		}
		if domain == "" && !sleep(ctx, time.Second) {
			return 0
		}
	}
	log.Printf("signed in as %s", domain)

	// 2. Listen for HTTPS. This fails when HTTPS certificates are switched off
	// for the tailnet; say so and keep trying, since the owner can fix it in
	// the Tailscale admin console without us restarting.
	var ln net.Listener
	for {
		var err error
		if ln, err = s.ListenTLS("tcp", ":443"); err == nil {
			// Fetch the certificate now, so "running" means a browser will get
			// a page and the first visit is not the slow one.
			cctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			_, _, err = lc.CertPair(cctx, domain)
			cancel()
			if err == nil {
				break
			}
			_ = ln.Close()
		}
		if ctx.Err() != nil {
			return 0
		}
		writeStatus(status{State: "error", DNSName: domain, Message: httpsHint(err)})
		if !sleep(ctx, 30*time.Second) {
			return 0
		}
	}

	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(backend)
			r.Out.Host = r.In.Host // the app builds links from the name it was asked for
			r.SetXForwarded()      // X-Forwarded-Proto: https
		},
		FlushInterval: -1, // stream responses (the in-app agent uses server-sent events)
	}
	srv := &http.Server{Handler: proxy, ReadHeaderTimeout: 30 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("serve: %v", err)
		}
	}()
	addr := "https://" + domain
	writeStatus(status{State: "running", DNSName: domain, URL: addr})
	log.Printf("serving %s -> %s", addr, backend)

	// 3. Stay up. If the node stops running (signed out or removed in the
	// admin console, key expired), exit non-zero: the supervisor restarts us,
	// and a fresh start asks for sign-in again with a new link.
	for sleep(ctx, 10*time.Second) {
		st, err := lc.StatusWithoutPeers(ctx)
		if err == nil && st.BackendState != "Running" {
			writeStatus(status{State: "starting", Message: "Tailscale went from Running to " + st.BackendState})
			_ = srv.Close()
			return 1
		}
	}
	_ = srv.Close()
	return 0
}

func httpsHint(err error) string {
	msg := "unknown error"
	if err != nil {
		msg = err.Error()
	}
	if strings.Contains(msg, "HTTPS") || strings.Contains(msg, "https") || strings.Contains(msg, "cert") {
		return "HTTPS certificates are switched off for your tailnet. Turn on HTTPS Certificates at https://login.tailscale.com/admin/dns, then wait a minute. (" + msg + ")"
	}
	return "Could not serve HTTPS on the tailnet: " + msg
}

func runLogout(s *tsnet.Server) int {
	if err := s.Start(); err != nil {
		log.Printf("could not start to sign out: %v", err)
		return 1
	}
	defer s.Close()
	lc, err := s.LocalClient()
	if err != nil {
		log.Printf("could not sign out: %v", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := lc.Logout(ctx); err != nil {
		log.Printf("could not sign out: %v", err)
		return 1
	}
	log.Printf("signed out")
	return 0
}

// sleep waits d, or returns false early when ctx ends.
func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}
