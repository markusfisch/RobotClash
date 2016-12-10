HTDOCS = htdocs
WEBROOT = hhsw.de@ssh.strato.de:sites/proto/ld37
OPTIONS = \
	--recursive \
	--links \
	--update \
	--delete-after \
	--times \
	--compress

live:
	rsync $(OPTIONS) $(HTDOCS)/* $(WEBROOT)
