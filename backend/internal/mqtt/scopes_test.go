package mqtt

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestScopeReportNormalization(t *testing.T) {
	key := strings.Repeat("AB", 32)
	for _, tc := range []struct {
		body           string
		count, entries int
	}{
		{`{"self":{"scopes":""}}`, 1, 0},
		{`{"self":{"scopes":"YKF,#ykf,$constructor"}}`, 1, 3},
		{`{"self":{"scopes":null}}`, 0, 0},
		{`{"self":{}}`, 0, 0},
		{fmt.Sprintf(`{"neighbors":[{"pubkey":%q,"status":"timeout","scopes":"#ykf"}]}`, key), 0, 0},
		{fmt.Sprintf(`{"neighbors":[{"pubkey":%q,"status":"responded","scopes":""}]}`, key), 1, 0},
		{`{"self":{"scopes":"#bad\nname"}}`, 0, 0},
	} {
		m, err := Normalize("meshcore/YKF/"+key+"/neighbors", []byte(tc.body), time.Now())
		if err != nil || len(m.ScopeReports) != tc.count {
			t.Fatalf("normalization: %s: %+v %v", tc.body, m.ScopeReports, err)
		}
		if tc.count > 0 && (len(m.ScopeReports[0].Entries) != tc.entries || m.ScopeReports[0].At != 0) {
			t.Fatal("list or unknown report time changed")
		}
		if len(m.ScopeReports) > 0 && m.QueueBytes() < 1200 {
			t.Fatal("scope strings missing from ingress budget")
		}
	}
}
