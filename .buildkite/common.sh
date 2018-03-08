make_outputs_dir () {
    QUICKTYPE_OUTPUTS="`mktemp -d`"
    git --no-pager show -s --format=fuller HEAD >"$QUICKTYPE_OUTPUTS/commit"
}

commit_outputs () {
    if [ "${FIXTURE:=none}" != "none" ] ; then
        FILENAME="outputs-`echo $FIXTURE | cksum | awk '{ print $1 }'`.tar.gz"
    else
        FILENAME="outputs.tar.gz"
    fi
    COMMIT=`git rev-parse "$BUILDKITE_COMMIT"`
    S3="s3://quicktype-outputs/$COMMIT/$FILENAME"
    tar -zcvf "$QUICKTYPE_OUTPUTS/outputs.tar.gz" "$QUICKTYPE_OUTPUTS"/*
    echo "Writing to $S3"
    ls -l "$QUICKTYPE_OUTPUTS/outputs.tar.gz"
    aws s3 cp --acl public-read "$QUICKTYPE_OUTPUTS/outputs.tar.gz" "$S3"
}
