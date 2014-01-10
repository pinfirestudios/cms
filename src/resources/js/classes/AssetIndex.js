/**
 * Asset index class
 */
Craft.AssetIndex = Craft.BaseElementIndex.extend({

	$buttons: null,
	$uploadButton: null,
	$progressBar: null,
	$folders: null,
	$previouslySelectedFolder: null,

	uploader: null,
	promptHandler: null,
	progressBar: null,

	initialSourceKey: null,
	isIndexBusy: false,
	_uploadTotalFiles: 0,
	_uploadFileProgress: {},
	_uploadedFileIds: [],
	_selectedFileIds: [],

	_singleFileMenu: null,
	_multiFileMenu: null,

	_fileDrag: null,
	_folderDrag: null,
	_expandDropTargetFolderTimeout: null,
	_tempExpandedFolders: [],

	init: function(elementType, $container, settings)
	{
		this.base(elementType, $container, settings);

		if (this.settings.context == 'index')
		{
			this.initIndexMode();
		}
	},

	/**
	 * Full blown Assets.
	 */
	initIndexMode: function ()
	{
		// Context menus for the folders
		var assetIndex = this;

		// ---------------------------------------
		// File dragging
		// ---------------------------------------
		this._fileDrag = new Garnish.DragDrop({
			activeDropTargetClass: 'sel assets-fm-dragtarget',
			helperOpacity: 0.5,

			filter: $.proxy(function()
			{
				return this.elementSelect.getSelectedItems();
			}, this),

			helper: $.proxy(function($file)
			{
				return this._getDragHelper($file);
			}, this),

			dropTargets: $.proxy(function()
			{
				var targets = [];

				this.$sources.each(function ()
				{
					targets.push($(this));
				});

				return targets;
			}, this),

			onDragStart: $.proxy(function()
			{
				this._tempExpandedFolders = [];

				this.$previouslySelectedFolder = this.$source.removeClass('sel');

			}, this),

			onDropTargetChange: $.proxy(this, '_onDropTargetChange'),

			onDragStop: $.proxy(this, '_onFileDragStop')
		});

		// ---------------------------------------
		// Folder dragging
		// ---------------------------------------
		this._folderDrag = new Garnish.DragDrop({
			activeDropTargetClass: 'sel assets-fm-dragtarget',
			helperOpacity: 0.5,

			filter: $.proxy(function()
			{
				// return each of the selected <a>'s parent <li>s, except for top level drag attampts.
				var $selected = this.sourceSelect.getSelectedItems(),
					draggees = [];
				for (var i = 0; i < $selected.length; i++)
				{

					var $source = $($selected[i]).parent();
					if ($source.parents('ul').length > 1)
					{
						draggees.push($source[0]);
					}
				}

				return $(draggees);
			}, this),

			helper: $.proxy(function($folder)
			{
				var $helper = $('<ul class="assets-fm-folderdrag" />').append($folder);

				// collapse this folder
				$folder.removeClass('expanded');

				// set the helper width to the folders container width
				$helper.width(this.$sidebar[0].scrollWidth);

				return $helper;
			}, this),

			dropTargets: $.proxy(function()
			{
				var targets = [];

				this.$sources.each(function ()
				{
				   if (!$(this).is(assetIndex._folderDrag.$draggee))
				   {
					   targets.push($(this));
				   }
				});

				return targets;
			}, this),

			onDragStart: $.proxy(function()
			{
				this._tempExpandedFolders = [];

				// hide the expanded draggees' subfolders
				this._folderDrag.$draggee.filter('.expanded').removeClass('expanded').addClass('expanded-tmp')
			}, this),

			onDropTargetChange: $.proxy(this, '_onDropTargetChange'),

			onDragStop: $.proxy(this, '_onFolderDragStop')
		});

		this.$sources.each(function () {
			assetIndex._createFolderContextMenu.apply(assetIndex, $(this));
			if ($(this).parents('ul').length > 1)
			{
				assetIndex._folderDrag.addItems($(this).parent());
			}
		});
	},

	_onFileDragStop: function ()
	{
		if (this._fileDrag.$activeDropTarget)
		{
			// keep it selected
			this._fileDrag.$activeDropTarget.addClass('sel');

			var targetFolderId = this._getFolderIdFromSourceKey(this._fileDrag.$activeDropTarget.data('key'));
			var originalFileIds = [],
				newFileNames = [];


			// For each file, prepare array data.
			for (var i = 0; i < this._fileDrag.$draggee.length; i++)
			{
				var originalFileId = this._fileDrag.$draggee[i].getAttribute('data-id'),
					fileName = $(this._fileDrag.$draggee[i]).find('[data-url]').attr('data-url').split('/').pop();

				originalFileIds.push(originalFileId);
				newFileNames.push(fileName);
			}

			// are any files actually getting moved?
			if (originalFileIds.length)
			{
				this.setIndexBusy();
				this.progressBar.resetProgressBar();
				this.progressBar.setItemCount(originalFileIds.length);
				this.progressBar.showProgressBar();


				// for each file to move a separate request
				var parameterArray = [];
				for (i = 0; i < originalFileIds.length; i++)
				{
					parameterArray.push({
						fileId: originalFileIds[i],
						folderId: targetFolderId,
						fileName: newFileNames[i]
					});
				}

				// define the callback for when all file moves are complete
				var onMoveFinish = $.proxy(function(responseArray)
				{
					this.promptHandler.resetPrompts();

					// loop trough all the responses
					for (var i = 0; i < responseArray.length; i++)
					{
						var data = responseArray[i];

						// push prompt into prompt array
						if (data.prompt)
						{
							this.promptHandler.addPrompt(data);
						}

						if (data.error)
						{
							alert(data.error);
						}
					}

					this.setIndexAvailable();
					this.progressBar.hideProgressBar();

					if (this.promptHandler.getPromptCount())
					{
						// define callback for completing all prompts
						var promptCallback = $.proxy(function(returnData)
						{
							var newParameterArray = [];

							// loop trough all returned data and prepare a new request array
							for (var i = 0; i < returnData.length; i++)
							{
								if (returnData[i].choice == 'cancel')
								{
									continue;
								}

								// find the matching request parameters for this file and modify them slightly
								for (var ii = 0; ii < parameterArray.length; ii++)
								{
									if (parameterArray[ii].fileName == returnData[i].fileName)
									{
										parameterArray[ii].action = returnData[i].choice;
										newParameterArray.push(parameterArray[ii]);
									}
								}
							}

							// nothing to do, carry on
							if (newParameterArray.length == 0)
							{
								this._selectSourceByFolderId(targetFolderId);
							}
							else
							{
								// start working
								this.setIndexBusy();
								this.progressBar.resetProgressBar();
								this.progressBar.setItemCount(this.promptHandler.getPromptCount());
								this.progressBar.showProgressBar();

								// move conflicting files again with resolutions now
								this._moveFile(newParameterArray, 0, onMoveFinish);
							}
						}, this);

						this._fileDrag.fadeOutHelpers();
						this.promptHandler.showBatchPrompts(promptCallback);
					}
					else
					{
						this._fileDrag.fadeOutHelpers();
						this._selectSourceByFolderId(targetFolderId);
					}
				}, this);

				// initiate the file move with the built array, index of 0 and callback to use when done
				this._moveFile(parameterArray, 0, onMoveFinish);

				// skip returning dragees
				return;
			}
		}
		else
		{
			this._collapseExtraExpandedFolders();
		}

		// re-select the previously selected folders
		this.$previouslySelectedFolder.addClass('sel');

		this._fileDrag.returnHelpersToDraggees();
	},

	_onFolderDragStop: function ()
	{
		// show the expanded draggees' subfolders
		this._folderDrag.$draggee.filter('.expanded-tmp').removeClass('expanded-tmp').addClass('expanded');

		// Only move if we have a valid target and we're not trying to move into our direct parent
		if (
			this._folderDrag.$activeDropTarget
				&& this._folderDrag.$activeDropTarget.siblings('ul').find('>li').filter(this._folderDrag.$draggee).length == 0)
		{

			var targetFolderId = this._getFolderIdFromSourceKey(this._folderDrag.$activeDropTarget.data('key'));

			this._collapseExtraExpandedFolders(targetFolderId);

			// get the old folder IDs, and sort them so that we're moving the most-nested folders first
			var folderIds = [];

			for (var i = 0; i < this._folderDrag.$draggee.length; i++)
			{
				var $a = $('> a', this._folderDrag.$draggee[i]),
					folderId = this._getFolderIdFromSourceKey($a.data('key')),
					$source = this._getSourceByFolderId(folderId);

				// make sure it's not already in the target folder
				if (this._getFolderIdFromSourceKey(this._getParentSource($source).data('key')) != targetFolderId)
				{
					folderIds.push(folderId);
				}
			}

			if (folderIds.length)
			{
				folderIds.sort();
				folderIds.reverse();

				this.setIndexBusy();
				this.progressBar.resetProgressBar();
				this.progressBar.setItemCount(folderIds.length);
				this.progressBar.showProgressBar();

				var responseArray = [];
				var parameterArray = [];

				for (var i = 0; i < folderIds.length; i++)
				{
					parameterArray.push({
						folderId: folderIds[i],
						parentId: targetFolderId
					});
				}

				// increment, so to avoid displaying folder files that are being moved
				this.requestId++;

				/*
				 Here's the rundown:
				 1) Send all the folders being moved
				 2) Get results:
				   a) For all conflicting, receive prompts and resolve them to get:
				   b) For all valid move operations: by now server has created the needed folders
					  in target destination. Server returns an array of file move operations
				   c) server also returns a list of all the folder id changes
				   d) and the data-id of node to be removed, in case of conflict
				   e) and a list of folders to delete after the move
				 3) From data in 2) build a large file move operation array
				 4) Create a request loop based on this, so we can display progress bar
				 5) when done, delete all the folders and perform other maintenance
				 6) Champagne
				 */

				// this will hold the final list of files to move
				var fileMoveList = [];

				// these folders have to be deleted at the end
				var folderDeleteList = [];

				// this one tracks the changed folder ids
				var changedFolderIds = {};

				var removeFromTree = [];

				var onMoveFinish = $.proxy(function(responseArray)
				{
					this.promptHandler.resetPrompts();

					// loop trough all the responses
					for (var i = 0; i < responseArray.length; i++)
					{
						var data = responseArray[i];

						// if succesful and have data, then update
						if (data.success)
						{
							if (data.transferList && data.deleteList && data.changedFolderIds)
							{
								for (var ii = 0; ii < data.transferList.length; ii++)
								{
									fileMoveList.push(data.transferList[ii]);
								}
								for (var ii = 0; ii < data.deleteList.length; ii++)
								{
									folderDeleteList.push(data.deleteList[ii]);
								}
								for (var oldFolderId in data.changedFolderIds)
								{
									changedFolderIds[oldFolderId] = data.changedFolderIds[oldFolderId];
								}
								removeFromTree.push(data.removeFromTree);
							}
						}

						// push prompt into prompt array
						if (data.prompt)
						{
							this.promptHandler.addPrompt(data);
						}

						if (data.error)
						{
							alert(data.error);
						}
					}

					if (this.promptHandler.getPromptCount())
					{
						// define callback for completing all prompts
						var promptCallback = $.proxy(function(returnData)
						{
							this.promptHandler.resetPrompts();
							this.setNewElementDataHtml('');

							var newParameterArray = [];

							// loop trough all returned data and prepare a new request array
							for (var i = 0; i < returnData.length; i++)
							{
								if (returnData[i].choice == 'cancel')
								{
									continue;
								}

								parameterArray[0].action = returnData[i].choice;
								newParameterArray.push(parameterArray[0]);

							}

							// start working on them lists, baby
							if (newParameterArray.length == 0)
							{
								$.proxy(this, '_performActualFolderMove', fileMoveList, folderDeleteList, changedFolderIds, removeFromTree)();
							}
							else
							{
								// start working
								this.setIndexBusy();
								this.progressBar.resetProgressBar();
								this.progressBar.setItemCount(this.promptHandler.getPromptCount());
								this.progressBar.showProgressBar();

								// move conflicting files again with resolutions now
								moveFolder(newParameterArray, 0, onMoveFinish);
							}
						}, this);

						this.promptHandler.showBatchPrompts(promptCallback);

						this.setIndexAvailable();
						this.progressBar.hideProgressBar();
					}
					else
					{
						$.proxy(this, '_performActualFolderMove', fileMoveList, folderDeleteList, changedFolderIds, removeFromTree, targetFolderId)();
					}

				}, this);

				var moveFolder = $.proxy(function(parameterArray, parameterIndex, callback)
				{
					if (parameterIndex == 0)
					{
						responseArray = [];
					}

					Craft.postActionRequest('assets/moveFolder', parameterArray[parameterIndex], $.proxy(function(data, textStatus) {

						parameterIndex++;
						this.progressBar.incrementProcessedItemCount(1);
						this.progressBar.updateProgressBar();

						if (textStatus == 'success')
						{
							responseArray.push(data);
						}

						if (parameterIndex >= parameterArray.length)
						{
							callback(responseArray);
						}
						else
						{
							moveFolder(parameterArray, parameterIndex, callback);
						}

					}, this));
				}, this);

				// initiate the folder move with the built array, index of 0 and callback to use when done
				moveFolder(parameterArray, 0, onMoveFinish);

				// skip returning dragees until we get the Ajax response
				return;
			}
		}
		else
		{
			this._collapseExtraExpandedFolders();
		}

		this._folderDrag.returnHelpersToDraggees();
	},

	/**
	 * Really move the folder. Like really. For real.
	 */
	_performActualFolderMove: function (fileMoveList, folderDeleteList, changedFolderIds, removeFromTree, targetFolderId)
	{
		this.setIndexBusy();
		this.progressBar.resetProgressBar();
		this.progressBar.setItemCount(1);
		this.progressBar.showProgressBar();


		var moveCallback = $.proxy(function(folderDeleteList, changedFolderIds, removeFromTree)
		{
			//Move the folders around in the tree
			var topFolderLi = $();
			var folderToMove = $();
			var topMovedFolderId = 0;

			// Change the folder ids
			for (var previousFolderId in changedFolderIds)
			{
				folderToMove = this._getSourceByFolderId(previousFolderId);

				// Change the id and select the containing element as the folder element.
				folderToMove = folderToMove
									.attr('data-key', 'folder:' + changedFolderIds[previousFolderId].newId)
									.data('key', 'folder:' + changedFolderIds[previousFolderId].newId).parent();

				if (topFolderLi.length == 0 || topFolderLi.parents().filter(folderToMove).length > 0)
				{
					topFolderLi = folderToMove;
					topFolderMovedId = changedFolderIds[previousFolderId].newId;
				}
			}

			if (topFolderLi.length == 0)
			{
				this.setIndexAvailable();
				this.progressBar.hideProgressBar();
				this._folderDrag.returnHelpersToDraggees();

				return;
			}

			var topFolder = topFolderLi.find('>a');

			// Now move the uppermost node.
			var siblings = topFolderLi.siblings('ul, .toggle');
			var parentSource = this._getParentSource(topFolder);

			var newParent = this._getSourceByFolderId(targetFolderId);
			this._prepareParentForChildren(newParent);
			this._addSubfolder(newParent, topFolderLi);

			topFolder.after(siblings);

			this._cleanUpTree(parentSource);
			this.$sidebar.find('ul>ul, ul>.toggle').remove();

			// delete the old folders
			for (var i = 0; i < folderDeleteList.length; i++)
			{
				Craft.postActionRequest('assets/deleteFolder', {folderId: folderDeleteList[i]});
			}

			this.setIndexAvailable();
			this.progressBar.hideProgressBar();
			this._folderDrag.returnHelpersToDraggees();
			this._selectSourceByFolderId(topFolderMovedId);

		}, this);

		if (fileMoveList.length > 0)
		{
			this._moveFile(fileMoveList, 0, $.proxy(function()
			{
				moveCallback(folderDeleteList, changedFolderIds, removeFromTree);
			}, this));
		}
		else
		{
			moveCallback(folderDeleteList, changedFolderIds, removeFromTree);
		}
	},

	/**
	 * Get parent source for a source.
	 * @param $source
	 * @returns {*}
	 * @private
	 */
	_getParentSource: function ($source)
	{
		if ($source.parents('ul').length == 1)
		{
			return null;
		}
		return $source.parent().parent().siblings('a');
	},

	/**
	 * Move a file using data from a parameter array.
	 *
	 * @param parameterArray
	 * @param parameterIndex
	 * @param callback
	 * @private
	 */
	_moveFile: function (parameterArray, parameterIndex, callback)
	{
		if (parameterIndex == 0)
		{
			this.responseArray = [];
		}

		Craft.postActionRequest('assets/moveFile', parameterArray[parameterIndex], $.proxy(function(data, textStatus) {

			this.progressBar.incrementProcessedItemCount(1);
			this.progressBar.updateProgressBar();

			if (textStatus == 'success')
			{
				this.responseArray.push(data);
			}

			parameterIndex++;

			if (parameterIndex >= parameterArray.length)
			{
				callback(this.responseArray);
			}
			else
			{
				this._moveFile(parameterArray, parameterIndex, callback);
			}

		}, this));
	},

	_selectSourceByFolderId: function (targetFolderId)
	{
		var targetSource = this._getSourceByFolderId(targetFolderId);

		// Make sure that all the parent sources are expanded and this source is visible.
		var parentSources = targetSource.parent().parents('li');
		parentSources.each(function () {
			if (!$(this).hasClass('expanded'))
			{
				$(this).find('> .toggle').click();
			}
		});

		this.selectSource(targetSource);
		this.updateElements();
	},

	/**
	 * Initialize the uploader.
	 *
	 * @private
	 */
	onAfterHtmlInit: function ()
	{
		if (!this.$buttons)
		{
			this.$buttons = $('<div class="buttons"></div>').prependTo(this.$sidebar);
		}

		if (!this.$uploadButton)
		{
			this.$uploadButton = $('<div class="assets-upload"><div class="assets-uploader"><a href="javascript:;" class="btn submit assets-upload-button" data-icon="↑" style="position: relative; overflow: hidden; direction: ltr; " role="button">' + Craft.t('Upload files') + '</a></div></div>').prependTo(this.$buttons);
			$uploadInput = $('<input type="file" multiple="multiple" name="assets-upload" id="assets-upload" />').hide().prependTo(this.$buttons);
		}

		this.promptHandler = new Craft.PromptHandler();
		this.progressBar = new Craft.ProgressBar(this.$main, true);
		this.progressBar.$progressBar.css({
			top: '20%'
		});

		var options = {
			url: Craft.getActionUrl('assets/uploadFile'),
			fileInput: $uploadInput
		};

		options.events = {
			fileuploadstart:       $.proxy(this, '_onUploadStart'),
			fileuploadprogressall: $.proxy(this, '_onUploadProgress'),
			fileuploaddone:        $.proxy(this, '_onUploadComplete')
		};

		this.uploader = new Craft.Uploader (this.$uploadButton, options);
		this.$uploadButton.on('click', $.proxy(function () {
			if (!this.isIndexBusy)
			{
				this.$buttons.find('input[type=file]').click();
			}
		}, this));

		this.base();
	},

	onSelectSource: function()
	{
		this.uploader.setParams({folderId: this._getFolderIdFromSourceKey(this.sourceKey)});

		this.base();
	},

	_getFolderIdFromSourceKey: function (sourceKey)
	{
		return sourceKey.split(':')[1];
	},

	/**
	 * React on upload submit.
	 *
	 * @param id
	 * @private
	 */
	_onUploadStart: function(event) {
		this.setIndexBusy();

		// Initial values
		this.progressBar.resetProgressBar();
		this.progressBar.showProgressBar();
	},

	/**
	 * Update uploaded byte count.
	 */
	_onUploadProgress: function(event, data) {
		var progress = parseInt(data.loaded / data.total * 100, 10);
		this.progressBar.setProgressPercentage(progress);
	},

	/**
	 * On Upload Complete.
	 */
	_onUploadComplete: function(event, data) {
		var response = data.result;
		var fileName = data.files[0].name;

		var doReload = true;

		if (response.success || response.prompt) {

			// Add the uploaded file to the selected ones, if appropriate
			this._uploadedFileIds.push(response.fileId);

			// If there is a prompt, add it to the queue
			if (response.prompt)
			{
				this.promptHandler.addPrompt(response);
			}
		}
		else
		{
			alert(Craft.t('Upload failed for {filename}', { filename: fileName }));
			doReload = false;
		}

		// for the last file, display prompts, if any. If not - just update the element view.
		if (this.uploader.isLastUpload()) {

			this.setIndexAvailable();
			this.progressBar.hideProgressBar();

			if (this.promptHandler.getPromptCount())
			{
				this.promptHandler.showBatchPrompts($.proxy(this, '_uploadFollowup'));
			}
			else
			{
				if (doReload)
				{
					this.updateElements();
				}

			}
		}
	},

	/**
	 * Follow up to an upload that triggered at least one conflict resolution prompt.
	 *
	 * @param returnData
	 * @private
	 */
	_uploadFollowup: function(returnData)
	{
		this.setIndexBusy();
		this.progressBar.resetProgressBar();

		this.promptHandler.resetPrompts();

		var finalCallback = $.proxy(function()
		{
			this.setIndexAvailable();
			this.progressBar.hideProgressBar();
			this.updateElements();
		}, this);

		this.progressBar.setItemCount(returnData.length);

		var doFollowup = $.proxy(function(parameterArray, parameterIndex, callback)
		{
			var postData = {
				additionalInfo: parameterArray[parameterIndex].additionalInfo,
				fileName:       parameterArray[parameterIndex].fileName,
				userResponse:   parameterArray[parameterIndex].choice
			};

			Craft.postActionRequest('assets/uploadFile', postData, $.proxy(function(data, textStatus) {

				if (textStatus == 'success' && data.fileId)
				{
					this._uploadedFileIds.push(data.fileId);
				}
				parameterIndex++;
				this.progressBar.incrementProcessedItemCount(1);
				this.progressBar.updateProgressBar();

				if (parameterIndex == parameterArray.length)
				{
					callback();
				}
				else
				{
					doFollowup(parameterArray, parameterIndex, callback);
				}
			}, this));

		}, this);

		this.progressBar.showProgressBar();
		doFollowup(returnData, 0, finalCallback);
	},

	/**
	 * Perform actions after updating elements
	 * @private
	 */
	onUpdateElements: function (append)
	{
		this.base(append);

		if (this.settings.context == 'index')
		{
			$elements = this.$elementContainer.children(':not(.disabled)');
			this._initElementSelect($elements);
			this._attachElementEvents($elements);
			this._initElementDragger($elements);
		}

		// See if we have freshly uploaded files to add to selection
		if (this._uploadedFileIds.length)
		{
			var item = null;
			for (var i = 0; i < this._uploadedFileIds.length; i++)
			{
				item = this.$main.find('[data-id=' + this._uploadedFileIds[i] + ']:first');
				this.elementSelect.selectItem(item);
			}

			// Reset the list.
			this._uploadedFileIds = [];
		}
	},

	_initElementSelect: function ($children)
	{

		if (typeof this.elementSelect == "object" && this.elementSelect != null)
		{
			this.elementSelect.destroy();
			delete this.elementSelect;
		}

		var elementSelect = new Garnish.Select(this.$elementContainer, $children, {
			multi: true,
			vertical: (this.getSelectedSourceState('mode') == 'table'),
			onSelectionChange: $.proxy(this, '_onElementSelectionChange')
		});

		this.setElementSelect(elementSelect);
	},

	_onElementSelectionChange: function ()
	{
		this._enableElementContextMenu();
		var selected = this.elementSelect.getSelectedItems();
		this._selectedFileIds = [];
		for (var i = 0; i < selected.length; i++)
		{
			this._selectedFileIds[i] = $(selected[i]).attr('data-id');
		}
	},

	_attachElementEvents: function ($elements)
	{
		// Doubleclick opens the HUD for editing
		this.removeListener($elements, 'dlbclick');
		this.addListener($elements, 'dblclick', $.proxy(this, '_editProperties'));

		// Context menus
		this._destroyElementContextMenus();
		this._createElementContextMenus($elements);
	},

	_initElementDragger: function ($elements)
	{
		this._fileDrag.removeAllItems();
		this._fileDrag.addItems($elements);
	},

	_editProperties: function (event)
	{
		var $target = $(event.currentTarget);
        if (this.getSelectedSourceState('mode') == 'table')
        {
            $target = $target.find('.element');
        }

		if (!$target.data('ElementEditor'))
		{
			var settings = {
				elementId: $target.attr('data-id'),
				$trigger: $target,
				loadContentAction: 'assets/editFileContent',
				saveContentAction: 'assets/saveFileContent'
			};
			$target.data('ElementEditor', new Craft.ElementEditor(settings));
		}

		$target.data('ElementEditor').show();
	},

	_createElementContextMenus: function ($elements)
	{
		var settings = {menuClass: 'menu assets-contextmenu'};

		var menuOptions = [{ label: Craft.t('View file'), onClick: $.proxy(this, '_viewFile') }];
		menuOptions.push({ label: Craft.t('Edit properties'), onClick: $.proxy(this, '_showProperties') });
		menuOptions.push({ label: Craft.t('Rename file'), onClick: $.proxy(this, '_renameFile') });
		menuOptions.push({ label: Craft.t('Copy reference tag'), onClick: $.proxy(this, '_copyRefTag') });
		menuOptions.push('-');
		menuOptions.push({ label: Craft.t('Delete file'), onClick: $.proxy(this, '_deleteFile') });
		this._singleFileMenu = new Garnish.ContextMenu($elements, menuOptions, settings);

		menuOptions = [{ label: Craft.t('Delete'), onClick: $.proxy(this, '_deleteFiles') }];
		this._multiFileMenu = new Garnish.ContextMenu($elements, menuOptions, settings);

		this._enableElementContextMenu();
	},

	_destroyElementContextMenus: function ()
	{
		if (this._singleFileMenu !== null)
		{
			this._singleFileMenu.destroy();
		}
		if (this._multiFileMenu !== null)
		{
			this._singleFileMenu.destroy();
		}
	},

	_enableElementContextMenu: function ()
	{
		this._multiFileMenu.disable();
		this._singleFileMenu.disable();

		if (this.elementSelect.getTotalSelected() == 1)
		{
			this._singleFileMenu.enable();
		}
		else if (this.elementSelect.getTotalSelected() > 1)
		{
			this._multiFileMenu.enable();
		}
	},

	_showProperties: function (event)
	{
		$(event.currentTarget).dblclick();
	},

	_viewFile: function (event)
	{
		window.open($(event.currentTarget).find('[data-url]').attr('data-url'));
	},

	/**
	 * Rename File
	 */
	_renameFile: function(event)
	{
		var $target = $(event.currentTarget);
		var fileId = $target.attr('data-id'),
			oldName = $target.find('[data-url]').attr('data-url').split('/').pop(),
			newName = prompt(Craft.t("Rename file"), oldName);

		if (newName && newName != oldName)
		{
			this.setIndexBusy();

			var postData = {
				fileId:   fileId,
				folderId: this._getFolderIdFromSourceKey(this.$source.data('key')),
				fileName: newName
			};

			var handleRename = function(data, textStatus)
			{
				this.setIndexAvailable();

				this.promptHandler.resetPrompts();
				if (textStatus == 'success')
				{
					if (data.prompt)
					{
						this.promptHandler.addPrompt(data);

						var callback = $.proxy(function (choice) {
							choice = choice[0].choice;
							if (choice != 'cancel')
							{
								postData.action = choice;
								Craft.postActionRequest('assets/moveFile', postData, $.proxy(handleRename, this));
							}
						}, this);

						this.promptHandler.showBatchPrompts(callback);
					}

					if (data.success)
					{
						this.updateElements();
					}

					if (data.error)
					{
						alert(data.error);
					}
				}
			};

			Craft.postActionRequest('assets/moveFile', postData, $.proxy(handleRename, this));
		}
	},

	_copyRefTag: function(event)
	{
		var message = Craft.t('{ctrl}C to copy.', {
			ctrl: (navigator.appVersion.indexOf('Mac') ? '⌘' : 'Ctrl-')
		});

		prompt(message, '{asset:'+$(event.currentTarget).data('id')+'}');
	},

	/**
	 * Delete a file
	 */
	_deleteFile: function (event) {

		var $target = $(event.currentTarget);
		var fileId = $target.attr('data-id');

		var fileName = $target.attr('data-label');

		if (confirm(Craft.t('Are you sure you want to delete “{name}”?', { name: fileName })))
		{
			if ($target.data('AssetEditor'))
			{
				$target.data('AssetEditor').removeHud();
			}

			this.setIndexBusy();

			Craft.postActionRequest('assets/deleteFile', {fileId: fileId}, $.proxy(function(data, textStatus) {

				this.setIndexAvailable();

				if (textStatus == 'success')
				{
					if (data.error)
					{
						alert(data.error);
					}

					this.updateElements();

				}

			}, this));
		}
	},

	/**
	 * Delete multiple files.
	 */
	_deleteFiles: function () {

		if (confirm(Craft.t("Are you sure you want to delete these {number} files?", {number: this.elementSelect.getTotalSelected()})))
		{
			this.setIndexBusy();

			var postData = {};

			for (var i = 0; i < this._selectedFileIds.length; i++)
			{
				postData['fileId['+i+']'] = this._selectedFileIds[i];
			}

			Craft.postActionRequest('assets/deleteFile', postData, $.proxy(function(data, textStatus) {

				this.setIndexAvailable();

				if (textStatus == 'success')
				{
					if (data.error)
					{
						alert(data.error);
					}

					this.updateElements();
				}

			}, this));
		}
	},

	_getDragHelper: function ($element)
	{
		var currentView = this.getSelectedSourceState('mode');
		switch (currentView)
		{
			case 'table':
			{
				var $container = $('<div class="assets-listview assets-lv-drag" />'),
					$table = $('<table cellpadding="0" cellspacing="0" border="0" />').appendTo($container),
					$tbody = $('<tbody />').appendTo($table);

				$table.width(this.$table.width());
				$tbody.append($element);

				return $container;
			}
			case 'thumbs':
			{
				return $('<ul class="thumbsview assets-tv-drag" />').append($element.removeClass('sel'));
			}
		}

		return $();
	},

	/**
	 * On Drop Target Change
	 */
	_onDropTargetChange: function($dropTarget)
	{
		clearTimeout(this._expandDropTargetFolderTimeout);

		if ($dropTarget)
		{
			var folderId = this._getFolderIdFromSourceKey($dropTarget.data('key'));

			if (folderId)
			{
				this.dropTargetFolder = this._getSourceByFolderId(folderId);

				if (this._hasSubfolders(this.dropTargetFolder) && ! this._isExpanded(this.dropTargetFolder))
				{
					this._expandDropTargetFolderTimeout = setTimeout($.proxy(this, '_expandFolder'), 500);
				}
			}
			else
			{
				this.dropTargetFolder = null;
			}
		}
	},

	/**
	 * Collapse Extra Expanded Folders
	 */
	_collapseExtraExpandedFolders: function(dropTargetFolderId)
	{

		clearTimeout(this._expandDropTargetFolderTimeout);

		// If a source id is passed in, exclude it's parents
		if (dropTargetFolderId)
		{
			var excluded = this._getSourceByFolderId(dropTargetFolderId).parents('li').find('>a');
		}

		for (var i = this._tempExpandedFolders.length-1; i >= 0; i--)
		{
			var source = this._tempExpandedFolders[i];

			// check the parent list, if a source id is passed in
			if (! dropTargetFolderId || excluded.filter('[data-key="' + source.data('key') + '"]').length == 0)
			{
				this._collapseFolder(source);
				this._tempExpandedFolders.splice(i, 1);
			}
		}
	},

	_getSourceByFolderId: function (folderId)
	{
		return this.$sources.filter('[data-key="folder:' + folderId + '"]');
	},

	_hasSubfolders: function (source)
	{
		return source.siblings('ul').find('li').length;
	},

	_isExpanded: function (source)
	{
		return source.parent('li').hasClass('expanded');
	},

	_expandFolder: function ()
	{
		// collapse any temp-expanded drop targets that aren't parents of this one
		this._collapseExtraExpandedFolders(this._getFolderIdFromSourceKey(this.dropTargetFolder.data('key')));

		this.dropTargetFolder.parent().find('> .toggle').click();

		// keep a record of that
		this._tempExpandedFolders.push(this.dropTargetFolder);

	},

	_collapseFolder: function (source)
	{
		var li = source.parent();
		if (li.hasClass('expanded'))
		{
			li.find('> .toggle').click();
		}
	},

	_createFolderContextMenu: function (element)
	{
		element = $(element);
		var menuOptions = [{ label: Craft.t('New subfolder'), onClick: $.proxy(this, '_createSubfolder', element) }];

		// For all folders that are not top folders
		if (element.parents('ul').length > 1)
		{
			menuOptions.push({ label: Craft.t('Rename folder'), onClick: $.proxy(this, '_renameFolder', element) });
			menuOptions.push({ label: Craft.t('Delete folder'), onClick: $.proxy(this, '_deleteFolder', element) });
		}
		new Garnish.ContextMenu(element, menuOptions, {menuClass: 'menu assets-contextmenu'});

	},

	_createSubfolder: function (parentFolder)
	{
		var subfolderName = prompt(Craft.t('Enter the name of the folder'));

		if (subfolderName)
		{
			var params = {
				parentId:  this._getFolderIdFromSourceKey(parentFolder.data('key')),
				folderName: subfolderName
			};

			this.setIndexBusy();

			Craft.postActionRequest('assets/createFolder', params, $.proxy(function(data, textStatus) {

				this.setIndexAvailable();

				if (textStatus == 'success' && data.success)
				{
					this._prepareParentForChildren(parentFolder);

					var subFolder = $('<li><a data-key="folder:' + data.folderId + '" data-has-thumbs="' + parentFolder.data('has-thumbs') + '">' + data.folderName + '</a></li>');

					var $a = subFolder.find('a');
					this._addSubfolder(parentFolder, subFolder);
					this._createFolderContextMenu($a);
					this.sourceSelect.addItems($a);
					this._folderDrag.addItems($a.parent());
					this.$sources = this.$sources.add($a);
				}

				if (textStatus == 'success' && data.error)
				{
					alert(data.error);
				}

			}, this));
		}
	},

	_deleteFolder: function (targetFolder)
	{
		if (confirm(Craft.t('Really delete folder “{folder}”?', {folder: $.trim(targetFolder.text())})))
		{
			var params = {
				folderId: this._getFolderIdFromSourceKey(targetFolder.data('key'))
			}

			this.setIndexBusy();

			Craft.postActionRequest('assets/deleteFolder', params, $.proxy(function(data, textStatus) {

				this.setIndexAvailable();

				if (textStatus == 'success' && data.success)
				{
					var parentFolder = this._getParentSource(targetFolder);

					// remove folder and any trace from it's parent, if needed.
					this.$sources = this.$sources.not(targetFolder);
					this.sourceSelect.removeItems(targetFolder);

					targetFolder.parent().remove();
					this._cleanUpTree(parentFolder);

				}

				if (textStatus == 'success' && data.error)
				{
					alert(data.error);
				}

			}, this));
		}
	},

	/**
	 * Rename
	 */
	_renameFolder: function(targetFolder)
	{
		var oldName = $.trim(targetFolder.text()),
			newName = prompt(Craft.t('Rename folder'), oldName);

		if (newName && newName != oldName)
		{
			var params = {
				folderId: this._getFolderIdFromSourceKey(targetFolder.data('key')),
				newName: newName
			};

			this.setIndexBusy();

			Craft.postActionRequest('assets/renameFolder', params, $.proxy(function(data, textStatus) {

				this.setIndexAvailable();

				if (textStatus == 'success' && data.success)
				{
					targetFolder.text(data.newName);
				}

				if (textStatus == 'success' && data.error)
				{
					alert(data.error);
				}

			}, this), 'json');
		}
	},

	/**
	 * Prepare a source folder for children folder.
	 *
	 * @param parentFolder
	 * @private
	 */
	_prepareParentForChildren: function (parentFolder)
	{
		if (!this._hasSubfolders(parentFolder))
		{
			parentFolder.parent().addClass('expanded').append('<div class="toggle"></div><ul></ul>');
			this.addListener(parentFolder.siblings('.toggle'), 'click', function(ev)
			{
				$(ev.currentTarget).parent().toggleClass('expanded');
			});

		}
	},

	/**
	 * Add a subfolder to the parent folder at the correct spot.
	 *
	 * @param parentFolder
	 * @param subFolder
	 * @private
	 */

	_addSubfolder: function (parentFolder, subFolder)
	{
		var existingChildren = parentFolder.siblings('ul').find('li');
		var folderInserted = false;
		existingChildren.each(function () {
			if (!folderInserted && $.trim($(this).text()) > $.trim(subFolder.text()))
			{
				$(this).before(subFolder);
				folderInserted = true;
			}
		});
		if (!folderInserted)
		{
			parentFolder.siblings('ul').append(subFolder);
		}
	},

	_cleanUpTree: function (parentFolder)
	{
		if (parentFolder !== null && parentFolder.siblings('ul').find('li').length == 0)
		{
			parentFolder.siblings('ul').remove();
			parentFolder.siblings('.toggle').remove();
			parentFolder.parent().removeClass('expanded');
		}
	}
});

// Register it!
Craft.registerElementIndexClass('Asset', Craft.AssetIndex);
