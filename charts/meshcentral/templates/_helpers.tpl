{{- define "meshcentral.labels" -}}
app.kubernetes.io/name: meshcentral
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "meshcentral.selectorLabels" -}}
app.kubernetes.io/name: meshcentral
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
